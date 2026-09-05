import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

// One Reload can cost twenty model calls, so unlike Refresh — which only
// spends GetXAPI polls and is metered by the poll TTL — it is metered by
// the day. Twelve is a working day of checking in every hour or so.
export const FEED_RELOAD_DAILY_LIMIT = 12;
export const FEED_RELOAD_EVENT_TYPE = "feed_reload";

export type FeedReloadUsage = {
  used: number;
  limit: number;
  remaining: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getFeedReloadUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<FeedReloadUsage> {
  const { count, error } = await supabase
    .from("usage_events")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("event_type", FEED_RELOAD_EVENT_TYPE)
    .gte("created_at", startOfCurrentUtcDay());

  if (error) throw error;

  const used = count ?? 0;
  return {
    used,
    limit: FEED_RELOAD_DAILY_LIMIT,
    remaining: Math.max(0, FEED_RELOAD_DAILY_LIMIT - used),
  };
}

// Recorded after the work, and only when replies were actually written: a
// Reload that found nothing new to read cost nothing and should not cost
// the user one of their twelve.
export async function recordFeedReload(
  supabase: SupabaseServerClient,
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: FEED_RELOAD_EVENT_TYPE,
    metadata,
  });

  if (error) throw error;
}
