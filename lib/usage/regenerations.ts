import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

export const REGENERATION_DAILY_LIMIT = 20;
export const REGENERATION_EVENT_TYPE = "draft_regenerate";

export type RegenerationUsage = {
  used: number;
  limit: number;
  remaining: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getRegenerationUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<RegenerationUsage> {
  const { count, error } = await supabase
    .from("usage_events")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("event_type", REGENERATION_EVENT_TYPE)
    .gte("created_at", startOfCurrentUtcDay());

  if (error) throw error;

  const used = count ?? 0;
  return {
    used,
    limit: REGENERATION_DAILY_LIMIT,
    remaining: Math.max(0, REGENERATION_DAILY_LIMIT - used),
  };
}

// Only explicit Regenerate clicks are metered. The Day 3 fetch route also
// generates drafts, but it's deduped and gated by GetXAPI credits, so it
// stays unmetered today — Day 12 may want to meter fetches too; this is an
// intentional omission, not an oversight.
export async function recordRegeneration(
  supabase: SupabaseServerClient,
  userId: string,
  tweetId: string,
): Promise<void> {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: REGENERATION_EVENT_TYPE,
    metadata: { tweet_id: tweetId },
  });

  if (error) throw error;
}
