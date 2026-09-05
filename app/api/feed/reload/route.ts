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
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      { error: "Build your Brand Pack before Reload can write replies." },
      { status: 400 },
    );
  }

  const usage = await getFeedReloadUsage(supabase, user.id).catch(() => null);
  if (usage && usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} Reloads for today. Refresh still pulls new posts.`,
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
    await pollProfiles(supabase, user.id, profileRows, { force: true });

    const stacks = await loadStacks(supabase, user.id);
    const { cards, summary } = await writeReloadReplies(
      supabase,
      user.id,
      brandPack as BrandPackRow,
      selectReloadCards(stacks),
    );

    // The Feed still shows everything undecided, not just this Reload's
    // slice — the replies are merged onto the cards that got one so a
    // Reload adds to the stream rather than replacing it.
    const written = new Map(cards.map((card) => [card.id, card]));
    const feed: FeedCard[] = flattenStacks(stacks).map(
      (card) => written.get(card.id) ?? card,
    );

    // Metered only when it actually cost model calls.
    if (summary.written > 0) {
      await recordFeedReload(supabase, user.id, {
        profiles: profileRows.length,
        per_profile: RELOAD_PER_PROFILE,
        ...summary,
      }).catch((error) => console.error("feed/reload usage record failed", error));
    }

    const refreshed = await getFeedReloadUsage(supabase, user.id).catch(() => usage);

    return NextResponse.json({ feed, summary, usage: refreshed });
  } catch (error) {
    console.error("feed/reload failed", error);
    return NextResponse.json(
      { error: "Failed to reload your Feed. Please try again." },
      { status: 502 },
    );
  }
}
