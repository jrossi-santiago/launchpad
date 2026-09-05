import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildMockFeedReply,
  callHaikuFeedReply,
  type FeedReplyResult,
  type ReplyTarget,
} from "@/lib/anthropic/feedReply";
import { pickOnTerritory } from "@/lib/anthropic/onTerritory";
import type { FeedCard, NetworkStack } from "@/lib/network/stack";

// What Reload means, in one place.
//
// The Refresh button re-polls and shows you whatever is undecided, which
// can be a week of backlog. Reload is the "I am here now" button: poll
// every watched account, take the newest few posts from each, and have
// Haiku read each one and write a reply for it before the Feed renders.

// Per account, per Reload. Five is the ask, and it is also what keeps the
// button honest on a phone: the newest handful from each account you
// watch, not everything they have ever posted.
export const RELOAD_PER_PROFILE = 5;

// The ceiling on model calls one Reload may make. Twenty-five accounts at
// five posts each is 125 replies, which is neither affordable nor within a
// request timeout, so the newest posts across all accounts win and the
// rest keep their cards without a reply. Raising this raises latency
// linearly — the whole button is one round trip.
export const RELOAD_REPLY_BUDGET = 20;

// Replies are written a few at a time for the same reason polls are:
// unbounded parallelism against the API is how you get rate-limited, and
// sequential would put twenty round trips on one button press.
const REPLY_CONCURRENCY = 4;

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
  // True when the budget, not the work, is what ended the run — the UI
  // says so rather than leaving unexplained cards without replies.
  budgetReached: boolean;
};

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
    content: card.content,
    quoted: card.quoted,
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
  options: { force?: boolean } = {},
): Promise<{ cards: FeedCard[]; summary: ReloadSummary }> {
  const now = Date.now();
  const summary: ReloadSummary = {
    considered: cards.length,
    written: 0,
    reused: 0,
    failed: 0,
    onTerritory: 0,
    declined: 0,
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

  const results = new Map<string, FeedReplyResult>();
  for (let i = 0; i < needsReply.length; i += REPLY_CONCURRENCY) {
    const batch = needsReply.slice(i, i + REPLY_CONCURRENCY);
    const written = await Promise.all(
      batch.map((card) =>
        writeReply(supabase, userId, brandPack, card, onTerritory.has(card.id)),
      ),
    );
    written.forEach((result, index) => {
      if (!result) {
        summary.failed += 1;
        return;
      }

      results.set(batch[index].id, result);

      if (!result.reply) {
        summary.declined += 1;
        return;
      }

      summary.written += 1;
      // Counted on the way out, not from the gate's picks: a card the
      // gate chose but the model failed on is not a reply you got.
      if (onTerritory.has(batch[index].id)) summary.onTerritory += 1;
    });
  }

  return {
    cards: cards.map((card) => {
      const result = results.get(card.id);
      return result
        ? {
            ...card,
            suggested_reply: result.reply,
            suggested_reply_at: new Date().toISOString(),
            reply_about: result.about,
            reply_unclear: result.reply ? null : (result.unclear ?? "No reason given."),
          }
        : card;
    }),
    summary,
  };
}
