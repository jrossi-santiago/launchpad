import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { pollProfiles } from "@/lib/network/poll";
import {
  RELOAD_PER_PROFILE,
  selectReloadCards,
  writeReloadReplies,
  type ReloadEvent,
} from "@/lib/network/reload";
import {
  flattenStacks,
  loadStacks,
  sortFeedForSweep,
  type NetworkProfileRow,
} from "@/lib/network/stack";
import { getFeedReloadUsage, recordFeedReload } from "@/lib/usage/feedReloads";

// A Reload is a poll of every watched account followed by up to thirty
// model calls, eight at a time. That is minutes, not milliseconds, in the
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

  // Everything above here can still fail as an ordinary JSON error, and
  // does: no session, no Brand Pack, no allowance left. Past this point
  // the response is a stream, so a failure is an `error` event inside it
  // rather than a status code — the headers are long gone by the time
  // anything can go wrong.
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A closed tab is not an error. The sweep keeps going when the
      // reader disappears — every reply is written to the database before
      // it is ever sent, so the work is not wasted, it is just unwatched.
      let open = true;
      const send = (event: ReloadEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      try {
        // A Re-Write rewrites what is on screen, so there is nothing to fetch.
        if (!rewrite) {
          await pollProfiles(supabase, user.id, profileRows, { force: true });
        }

        const stacks = await loadStacks(supabase, user.id);
        // The Feed still shows everything undecided, not just this
        // Reload's slice — the replies are merged onto the cards that get
        // one, so a Reload adds to the stream rather than replacing it.
        const everything = flattenStacks(stacks);

        const { summary } = await writeReloadReplies(
          supabase,
          user.id,
          brandPack as BrandPackRow,
          rewrite ? everything : selectReloadCards(stacks),
          {
            force: rewrite,
            // The whole Feed, in its final order, before the first model
            // call. This is the event that ends the wait: the posts are
            // on screen from here, and the replies arrive underneath them.
            onPending: (pending) => {
              const ids = new Set(pending.map((card) => card.id));
              send({
                type: "feed",
                feed: sortFeedForSweep(everything, ids),
                pending: [...ids],
              });
            },
            onReply: (card) => send({ type: "reply", card }),
          },
        );

        // Metered only when it actually cost model calls.
        if (summary.written > 0) {
          await recordFeedReload(supabase, user.id, {
            mode: rewrite ? "rewrite" : "reload",
            profiles: profileRows.length,
            per_profile: rewrite ? null : RELOAD_PER_PROFILE,
            ...summary,
          }).catch((error) =>
            console.error("feed/reload usage record failed", error),
          );
        }

        const refreshed = await getFeedReloadUsage(supabase, user.id).catch(
          () => usage,
        );

        send({ type: "done", summary, usage: refreshed });
      } catch (error) {
        console.error("feed/reload failed", error);
        send({
          type: "error",
          error: rewrite
            ? "Failed to rewrite your replies. Please try again."
            : "Failed to reload your Feed. Please try again.",
        });
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Nginx and friends will happily hold a streamed response until it
      // finishes, which would put the wait back exactly where it was.
      "x-accel-buffering": "no",
    },
  });
}
