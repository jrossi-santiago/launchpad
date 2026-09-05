import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildMockFeedReply,
  callHaikuFeedReply,
  type FeedReplyResult,
  type ReplyTarget,
} from "@/lib/anthropic/feedReply";
import { pickOnTerritory } from "@/lib/anthropic/onTerritory";
import { STACK_WINDOW, type FeedCard, type NetworkStack } from "@/lib/network/stack";
import type { FeedReloadUsage } from "@/lib/usage/feedReloads";

// What Reload means, in one place.
//
// The Refresh button re-polls and shows you whatever is undecided, which
// can be a week of backlog. Reload is the "I am here now" button: poll
// every watched account, take the newest few posts from each, and have
// Haiku read each one and write a reply for it before the Feed renders.

// Per account, per Reload — the whole of a stack, since STACK_WINDOW is
// what a Feed holds per account in the first place. It tracks that
// window: anything smaller leaves the older half of every stack sitting
// there reply-less for no reason a user could see.
export const RELOAD_PER_PROFILE = STACK_WINDOW;

// The ceiling on model calls one Reload may make, and the binding limit
// for anyone watching more than seven accounts: twenty-five accounts at
// four posts each is 100 replies, which is neither affordable nor within
// a request timeout. The newest posts across all accounts win and the rest
// keep their cards without a reply, which is what "Reload again for the
// rest" in the summary is telling you.
//
// Raising it raises latency linearly — the whole button is one round trip
// — so it moved with RELOAD_PER_PROFILE rather than in proportion to it.
export const RELOAD_REPLY_BUDGET = 30;

// Replies are written a few at a time for the same reason polls are:
// unbounded parallelism against the API is how you get rate-limited, and
// sequential would put twenty round trips on one button press.
//
// Eight rather than four, and a pool rather than waves. The old shape
// took the batch four at a time and awaited all four, so every group ran
// at the speed of its slowest member — and the slow member is usually a
// card that failed a validator and is paying for a second call. A pool
// starts the next card the moment a lane frees, which is worth about as
// much as the doubled width itself. Rate limiting is handled a layer
// down, in lib/anthropic/client.ts, which is what makes eight safe.
const REPLY_CONCURRENCY = 8;

// A reply written against a post keeps until the post itself has moved on.
// Inside this window a Reload leaves the existing reply alone and spends
// its budget on posts that have none; outside it, the card is rewritten.
export const REPLY_TTL_MS = 6 * 60 * 60 * 1000;

export type ReloadSummary = {
  // Cards considered — the newest RELOAD_PER_PROFILE from each account.
  considered: number;
  written: number;
  reused: number;
  failed: number;
  // How many of the written replies were judged to be about the founder's
  // own field, and so were written with the Brand Pack's agenda in hand.
  // Everything else was written voice-only.
  onTerritory: number;
  // Cards the model read and declined to reply to, because the post
  // turned on something it was not given. Not a failure — the alternative
  // was a reply that pretended.
  declined: number;
  // Replies that came from the spare draft rather than the first one —
  // cards whose best reply failed its shape check and were saved by the
  // second one arriving in the same call. Each of these would have cost a
  // second round trip before.
  alternate: number;
  // Cards where both drafts failed and a corrective second call was
  // spent, whether or not it produced anything. What alternate did not
  // catch.
  retried: number;
  // True when the budget, not the work, is what ended the run — the UI
  // says so rather than leaving unexplained cards without replies.
  budgetReached: boolean;
};

// What a Reload sends back, as it happens.
//
// The button used to be one request that returned one object, and it took
// as long as thirty model calls take — up to a minute and a half of
// nothing, with a spinner and a note apologising for it. The work is the
// same length; what changed is that the Feed no longer waits for the end
// of it. The route streams these as newline-delimited JSON:
//
//   feed   once, as soon as the posts are pulled and the sweep knows what
//          it is going to write. Every card, in its final order, with the
//          ids of the ones a reply is coming for.
//   reply  one per card, as each finishes. A card that failed or was
//          declined arrives here too — settled is settled.
//   done   the summary and the refreshed allowance, at the end.
//   error  a sweep that fell over. Terminal, and never partway through a
//          card: the replies already sent are already saved.
export type ReloadEvent =
  | { type: "feed"; feed: FeedCard[]; pending: string[] }
  | { type: "reply"; card: FeedCard }
  | { type: "done"; summary: ReloadSummary; usage: FeedReloadUsage | null }
  | { type: "error"; error: string };

// A decline counts as fresh alongside a reply: the model read this post
// within the window and said it could not follow it, and asking the same
// model the same question again inside six hours buys nothing. Re-Write
// still forces past it, which is where a second look belongs.
function isReplyFresh(card: FeedCard, now: number): boolean {
  if (!card.suggested_reply && !card.reply_unclear) return false;
  if (!card.suggested_reply_at) return false;
  const written = Date.parse(card.suggested_reply_at);
  if (Number.isNaN(written)) return false;
  return now - written < REPLY_TTL_MS;
}

// The newest RELOAD_PER_PROFILE cards per account, newest first overall.
// Reload's slice, not the stack's: STACK_WINDOW decides how deep a stack
// goes, this decides how much of it a Reload is willing to read.
export function selectReloadCards(stacks: NetworkStack[]): FeedCard[] {
  return stacks
    .flatMap((stack) =>
      stack.cards.slice(0, RELOAD_PER_PROFILE).map((card) => ({
        ...card,
        profile_id: stack.profile.id,
        handle: stack.profile.handle,
        display_name: stack.profile.display_name,
        bio: stack.profile.bio,
      })),
    )
    .sort((a, b) => {
      const left = a.posted_at ? Date.parse(a.posted_at) : 0;
      const right = b.posted_at ? Date.parse(b.posted_at) : 0;
      return right - left;
    });
}

function toTarget(card: FeedCard): ReplyTarget {
  return {
    handle: card.handle,
    display_name: card.display_name,
    bio: card.bio,
    content: card.content,
    quoted: card.quoted,
    context: card.context,
  };
}

// Writes a reply for one card and persists it. Never throws: one post the
// model chokes on must not cost the other nineteen, so the failure is
// counted and the card simply arrives without a reply.
async function writeReply(
  supabase: SupabaseClient,
  userId: string,
  brandPack: BrandPackRow,
  card: FeedCard,
  onTerritory: boolean,
  sweepId: string,
): Promise<FeedReplyResult | null> {
  try {
    const result = process.env.ANTHROPIC_API_KEY
      ? await callHaikuFeedReply(brandPack, toTarget(card), onTerritory)
      : buildMockFeedReply(toTarget(card));

    const writtenAt = new Date().toISOString();
    const { error } = await supabase
      .from("network_tweets")
      .update({
        suggested_reply: result.reply,
        suggested_reply_at: writtenAt,
        // Cleared alongside the reply it belongs to: a CTA left behind
        // from a previous sweep would attach itself to a new comment it
        // was never written for.
        suggested_cta: result.reply ? result.cta : null,
        // Which of the four comment types the reply is, so the card can
        // say so. Null on a decline, same as the reply itself.
        reply_type: result.commentType,
        reply_sweep_id: sweepId,
        reply_about: result.about,
        // Only kept when it is the reason there is no reply. On a card
        // that did get one, what the model was missing did not stop it,
        // and showing it would just be noise under a usable reply.
        reply_unclear: result.reply ? null : (result.unclear ?? "No reason given."),
      })
      .eq("id", card.id)
      .eq("user_id", userId);

    if (error) throw error;
    return result;
  } catch (error) {
    console.error(`feed reload reply failed for card ${card.id}`, error);
    return null;
  }
}

// Fills in replies for the selected cards and returns them with the
// replies attached, alongside what it did. The returned cards are the ones
// Reload considered — the caller decides what the rest of the Feed looks
// like around them.
//
// `force` is Re-Write: every card is written again, whatever it is
// holding. The TTL exists so a second Reload does not pay twice for the
// same post, and that is exactly what someone pressing Re-Write is asking
// to override — they have read the replies and want another set.
export async function writeReloadReplies(
  supabase: SupabaseClient,
  userId: string,
  brandPack: BrandPackRow,
  cards: FeedCard[],
  options: {
    force?: boolean;
    // Which cards this sweep is going to write for, handed over as soon
    // as that is known and before the first model call. The streaming
    // route sends it so the Feed can mark those cards as being written
    // while they are being written, rather than showing thirty identical
    // empty cards and one spinner.
    onPending?: (pending: FeedCard[]) => void;
    // One card, finished. `result` is null when the write failed, which
    // is not the same as a decline — a decline is a result.
    onReply?: (card: FeedCard, result: FeedReplyResult | null) => void;
  } = {},
): Promise<{ cards: FeedCard[]; summary: ReloadSummary }> {
  // Stamped on everything this run writes, so the Feed can tell its work
  // from a reply carried over without inferring it from timestamps.
  const sweepId = crypto.randomUUID();
  const now = Date.now();
  const summary: ReloadSummary = {
    considered: cards.length,
    written: 0,
    reused: 0,
    failed: 0,
    onTerritory: 0,
    declined: 0,
    alternate: 0,
    retried: 0,
    budgetReached: false,
  };

  const needsReply: FeedCard[] = [];
  for (const card of cards) {
    if (!options.force && isReplyFresh(card, now)) {
      summary.reused += 1;
    } else if (needsReply.length < RELOAD_REPLY_BUDGET) {
      needsReply.push(card);
    } else {
      summary.budgetReached = true;
    }
  }

  options.onPending?.(needsReply);

  // One pass over the whole batch decides which posts are actually about
  // the founder's field, before any reply is written. Only those few see
  // the agenda; the rest are written voice-only and cannot lean anywhere.
  const onTerritory = await pickOnTerritory(
    brandPack,
    needsReply.map((card) => ({
      id: card.id,
      handle: card.handle,
      content: card.content,
    })),
  );

  // A pool, not waves. Each lane takes the next card the moment it is
  // free, so one card paying for a corrective retry no longer holds seven
  // others still.
  const results = new Map<string, FeedReplyResult>();
  let nextIndex = 0;

  async function lane(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= needsReply.length) return;

      const card = needsReply[index];
      const result = await writeReply(
        supabase,
        userId,
        brandPack,
        card,
        onTerritory.has(card.id),
        sweepId,
      );

      if (!result) {
        summary.failed += 1;
        // Reported even so: the card is done being waited for, and a
        // stream that never mentions it again leaves it spinning.
        options.onReply?.(card, null);
        continue;
      }

      results.set(card.id, result);

      if (result.retried) summary.retried += 1;
      if (result.source === "alternate") summary.alternate += 1;

      if (!result.reply) {
        summary.declined += 1;
      } else {
        summary.written += 1;
        // Counted on the way out, not from the gate's picks: a card the
        // gate chose but the model failed on is not a reply you got.
        if (onTerritory.has(card.id)) summary.onTerritory += 1;
      }

      options.onReply?.(withResult(card, result, sweepId), result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REPLY_CONCURRENCY, needsReply.length) }, () =>
      lane(),
    ),
  );

  return {
    cards: cards.map((card) => {
      const result = results.get(card.id);
      return result ? withResult(card, result, sweepId) : card;
    }),
    summary,
  };
}

// One reply, merged onto the card it was written for. Shared by the
// streamed card and the returned one so a caller reading the stream and a
// caller reading the return value are looking at the same thing.
function withResult(
  card: FeedCard,
  result: FeedReplyResult,
  sweepId: string,
): FeedCard {
  return {
    ...card,
    suggested_reply: result.reply,
    suggested_reply_at: new Date().toISOString(),
    suggested_cta: result.reply ? result.cta : null,
    reply_type: result.commentType,
    reply_sweep_id: sweepId,
    reply_about: result.about,
    reply_unclear: result.reply ? null : (result.unclear ?? "No reason given."),
  };
}
