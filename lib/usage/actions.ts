import type { createClient } from "@/lib/supabase/server";
import { startOfCurrentUtcDay } from "@/lib/usage/dailyBoundary";

export const ACTION_DAILY_LIMITS = { reply: 8, like: 20, follow: 10 } as const;

export type ActionUsage = {
  used: number;
  limit: number;
  remaining: number;
};

export type AllActionUsage = {
  reply: ActionUsage;
  like: ActionUsage;
  follow: ActionUsage;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Counts today's successful actions rows for one action_type — the same
// shape as getRegenerationUsage() in lib/usage/regenerations.ts. This is
// the single source of truth for daily caps; there is no parallel counter.
export async function getActionUsage(
  supabase: SupabaseServerClient,
  userId: string,
  actionType: "reply" | "like" | "follow",
): Promise<ActionUsage> {
  const { count, error } = await supabase
    .from("actions")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("action_type", actionType)
    .eq("status", "success")
    .gte("created_at", startOfCurrentUtcDay());

  if (error) throw error;

  const limit = ACTION_DAILY_LIMITS[actionType];
  const used = count ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function getAllActionUsage(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<AllActionUsage> {
  const [reply, like, follow] = await Promise.all([
    getActionUsage(supabase, userId, "reply"),
    getActionUsage(supabase, userId, "like"),
    getActionUsage(supabase, userId, "follow"),
  ]);

  return { reply, like, follow };
}
