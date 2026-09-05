import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

// Three a day. One press is a search plus ten Sonnet reads, which is the
// most expensive thing in the app per click, and three is the shape of
// the habit anyway: morning, midday, evening.
export const HEAT_CHECK_DAILY_LIMIT = 3;
export const HEAT_CHECK_EVENT_TYPE = "heat_check";

export type HeatCheckUsage = {
  used: number;
  limit: number;
  remaining: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getHeatCheckUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<HeatCheckUsage> {
  const { count, error } = await supabase
    .from("usage_events")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("event_type", HEAT_CHECK_EVENT_TYPE)
    .gte("created_at", startOfCurrentUtcDay());

  if (error) throw error;

  const used = count ?? 0;
  return {
    used,
    limit: HEAT_CHECK_DAILY_LIMIT,
    remaining: Math.max(0, HEAT_CHECK_DAILY_LIMIT - used),
  };
}

// Recorded after the work, and only when the run produced cards: a search
// that matched nothing cost a GetXAPI call and no model calls, and should
// not cost the user one of their three.
export async function recordHeatCheck(
  supabase: SupabaseServerClient,
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: HEAT_CHECK_EVENT_TYPE,
    metadata,
  });

  if (error) throw error;
}
