import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

// The three buttons on a declined Feed card, metered.
//
// One press is one Haiku call — two at most, when the corrective retry
// fires — against a Reload's thirty. So this is deliberately the loosest
// allowance in the app: it is the cheap button, it is pressed one post at
// a time by someone who has already decided that post is worth a comment,
// and the thing it replaces is the three-draft pack, which costs a queue
// row and one of twenty regenerations.
//
// Thirty is roughly "every declined card in a busy day, twice". It exists
// to stop a stuck loop spending the API key, not to ration the feature.
export const FEED_WRITE_DAILY_LIMIT = 30;
export const FEED_WRITE_EVENT_TYPE = "feed_write_one";

export type FeedWriteUsage = {
  used: number;
  limit: number;
  remaining: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getFeedWriteUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<FeedWriteUsage> {
  const { count, error } = await supabase
    .from("usage_events")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("event_type", FEED_WRITE_EVENT_TYPE)
    .gte("created_at", startOfCurrentUtcDay());

  if (error) throw error;

  const used = count ?? 0;
  return {
    used,
    limit: FEED_WRITE_DAILY_LIMIT,
    remaining: Math.max(0, FEED_WRITE_DAILY_LIMIT - used),
  };
}

// Recorded after the comment is written, not before it is attempted: a
// press that failed produced nothing to send, and charging for it would
// make an outage cost the user their day's allowance.
export async function recordFeedWrite(
  supabase: SupabaseServerClient,
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: FEED_WRITE_EVENT_TYPE,
    metadata,
  });

  if (error) throw error;
}
