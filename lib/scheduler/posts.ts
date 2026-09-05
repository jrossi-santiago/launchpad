import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

// X's limit for a post without a subscription. The same number the
// comment side uses (COMMENT_MAX in lib/anthropic/comment.ts), kept
// separate because they are two different budgets that happen to agree
// today: a comment is deliberately shorter than it is allowed to be, a
// post is allowed all of it.
export const POST_MAX = 280;

// Posts per UTC day. Five is the number the founder asked for, and it is
// a cap on *sends*, not on drafts — line up as many as you like, five go
// out. It sits alongside ACTION_DAILY_LIMITS in lib/usage/actions.ts
// rather than inside it: those are counted from the `actions` table,
// which is keyed to a tweet row a standalone post does not have.
export const POST_DAILY_LIMIT = 5;

export type ScheduledPostStatus =
  | "draft"
  | "scheduled"
  | "claimed"
  | "posted"
  | "failed"
  | "canceled";

export type ScheduledPostRow = {
  id: string;
  user_id: string;
  body: string;
  status: ScheduledPostStatus;
  scheduled_at: string | null;
  attempts: number;
  claimed_at: string | null;
  last_error: string | null;
  posted_at: string | null;
  posted_x_tweet_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type PostUsage = {
  used: number;
  limit: number;
  remaining: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Today's sends, counted off the rows themselves. Same shape as
// getActionUsage() and getRegenerationUsage(): count what actually
// happened since the UTC day boundary, keep no parallel counter that
// could drift from it.
export async function getPostUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<PostUsage> {
  const { count, error } = await supabase
    .from("scheduled_posts")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("status", "posted")
    .gte("posted_at", startOfCurrentUtcDay());

  if (error) throw error;

  const used = count ?? 0;
  return {
    used,
    limit: POST_DAILY_LIMIT,
    remaining: Math.max(0, POST_DAILY_LIMIT - used),
  };
}

// What the composer and both send paths agree a post has to be. Trimmed
// here so the check and the stored text are the same string — a body
// that passes on its trimmed length and is then stored untrimmed is a
// post X rejects at the moment nobody is watching.
export function validateBody(value: unknown): { body: string } | { error: string } {
  if (typeof value !== "string") return { error: "A post needs some text." };

  const body = value.trim();
  if (!body) return { error: "A post needs some text." };
  if (body.length > POST_MAX) {
    return { error: `That's ${body.length} characters. X allows ${POST_MAX}.` };
  }

  return { body };
}

// A scheduled time has to be in the future, and far enough into it that
// the next cron tick has not already passed it. The worker runs every
// five minutes, so anything inside the next minute is really "now" — and
// "now" is the Post now button, not a schedule.
export function validateScheduledAt(value: unknown): { at: Date } | { error: string } {
  if (typeof value !== "string") return { error: "Pick a time for this post." };

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { error: "That isn't a valid time." };
  if (at.getTime() < Date.now() + 60_000) {
    return { error: "Pick a time at least a minute from now." };
  }

  return { at };
}
