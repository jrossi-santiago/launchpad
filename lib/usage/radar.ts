import type { createClient } from "@/lib/supabase/server";

export const RADAR_SEARCH_EVENT_TYPE = "radar_search_page";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Not a daily cap like regenerations — just a per-fetch log. Called only on
// an actual GetXAPI (or mock) fetch, never on a cache hit. Day 6's "each
// page = usage_event" reuses this verbatim for page 2+.
export async function recordRadarSearchPage(
  supabase: SupabaseServerClient,
  userId: string,
  metadata: {
    query: string;
    product: string;
    minFaves: number;
    rangeHours: number;
    cursor: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: RADAR_SEARCH_EVENT_TYPE,
    metadata,
  });

  if (error) throw error;
}
