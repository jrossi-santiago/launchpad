import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { pollProfiles } from "@/lib/network/poll";
import {
  RELOAD_PER_PROFILE,
  selectReloadCards,
  writeReloadReplies,
} from "@/lib/network/reload";
import {
  flattenStacks,
  loadStacks,
  sortFeed,
  type FeedCard,
  type NetworkProfileRow,
} from "@/lib/network/stack";
import { getFeedReloadUsage, recordFeedReload } from "@/lib/usage/feedReloads";

// A Reload is a poll of every watched account followed by up to twenty
// model calls, four at a time. That is minutes, not milliseconds, in the
// worst case, so the route asks for the room to finish rather than being
// cut off half way through with the replies it paid for unreturned.
export const maxDuration = 300;

// The Feed's Reload button: poll every watched account, take the newest
// few posts from each, and have Haiku read each one and write a reply for
// it. Refresh (POST /api/network/refresh) is the cheap version — same
// poll, no reading — and stays the default on page load.
//
// `{ rewrite: true }` is the Re-Write button, and it differs in both
// halves. It does not poll — the posts you are looking at are the ones
// you want rewritten, and pulling new ones mid-sweep would push them off
// the budget — and it ignores the reply TTL, so a card that already has a
// reply gets a fresh one instead of keeping what it has. It also sweeps
// the whole Feed rather than the newest few per account: "all posts" is
// the point of it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rewrite =
    body && typeof body === "object" && (body as { rewrite?: unknown }).rewrite === true;

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      {
        error: `Build your Brand Pack before ${rewrite ? "Re-Write" : "Reload"} can write replies.`,
      },
      { status: 400 },
    );
  }

  const usage = await getFeedReloadUsage(supabase, user.id).catch(() => null);
  if (usage && usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} Reloads for today — Re-Write draws on the same allowance. Refresh still pulls new posts.`,
        usage,
      },
      { status: 429 },
    );
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("network_profiles")
    .select("*")
    .eq("user_id", user.id);

  if (profilesError) {
    console.error("feed/reload load profiles failed", profilesError);
    return NextResponse.json({ error: "Failed to reload your Feed." }, { status: 500 });
  }

  const profileRows = (profiles ?? []) as NetworkProfileRow[];

  try {
    // A Re-Write rewrites what is on screen, so there is nothing to fetch.
    if (!rewrite) {
      await pollProfiles(supabase, user.id, profileRows, { force: true });
    }

    const stacks = await loadStacks(supabase, user.id);
    const { cards, summary } = await writeReloadReplies(
      supabase,
      user.id,
      brandPack as BrandPackRow,
      rewrite ? flattenStacks(stacks) : selectReloadCards(stacks),
      { force: rewrite },
    );

    // The Feed still shows everything undecided, not just this Reload's
    // slice — the replies are merged onto the cards that got one so a
    // Reload adds to the stream rather than replacing it.
    //
    // Sorted after the merge, not before: the stacks were loaded before a
    // single reply existed, so ordering them first would rank every reply
    // this sweep just wrote as though it were still missing.
    const written = new Map(cards.map((card) => [card.id, card]));
    const feed: FeedCard[] = sortFeed(
      flattenStacks(stacks).map((card) => written.get(card.id) ?? card),
    );

    // Metered only when it actually cost model calls.
    if (summary.written > 0) {
      await recordFeedReload(supabase, user.id, {
        mode: rewrite ? "rewrite" : "reload",
        profiles: profileRows.length,
        per_profile: rewrite ? null : RELOAD_PER_PROFILE,
        ...summary,
      }).catch((error) => console.error("feed/reload usage record failed", error));
    }

    const refreshed = await getFeedReloadUsage(supabase, user.id).catch(() => usage);

    return NextResponse.json({ feed, summary, usage: refreshed, mode: rewrite ? "rewrite" : "reload" });
  } catch (error) {
    console.error("feed/reload failed", error);
    return NextResponse.json(
      {
        error: rewrite
          ? "Failed to rewrite your replies. Please try again."
          : "Failed to reload your Feed. Please try again.",
      },
      { status: 502 },
    );
  }
}
