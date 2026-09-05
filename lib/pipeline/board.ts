import type { SupabaseClient } from "@supabase/supabase-js";
import {
  effectiveLiveCap,
  isLiveLike,
  laneFor,
  nextActionFor,
  suggestionFor,
  shouldSuggestReplace,
  type CommentEventRow,
  type NextAction,
  type PipelineLeadRow,
  type Suggestion,
} from "@/lib/pipeline/rules";

// A lead plus everything the UI would otherwise have to recompute: which
// column it sits in, what the chip says, and whether Replace is on the
// table. Worked out on the server so the three columns and Room 2 agree
// about a lead without duplicating the rules in two components.
export type PipelineCard = {
  lead: PipelineLeadRow;
  nextAction: NextAction;
  suggestion: Suggestion | null;
  replaceSuggested: boolean;
  events: CommentEventRow[];
};

export type PipelineBoard = {
  waitlist: PipelineCard[];
  live: PipelineCard[];
  backlog: PipelineCard[];
  liveCount: number;
  liveCap: number;
};

export async function countLive(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("pipeline_leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["live", "seen_you", "conversation", "pitched"]);

  return count ?? 0;
}

export async function loadLiveCap(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("users")
    .select("pipeline_live_cap")
    .eq("id", userId)
    .maybeSingle();

  return effectiveLiveCap(
    (data as { pipeline_live_cap?: number } | null)?.pipeline_live_cap,
  );
}

export async function loadBoard(
  supabase: SupabaseClient,
  userId: string,
  now: number = Date.now(),
): Promise<PipelineBoard> {
  const [{ data: leadRows }, liveCap] = await Promise.all([
    supabase
      .from("pipeline_leads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    loadLiveCap(supabase, userId),
  ]);

  const leads = (leadRows ?? []) as PipelineLeadRow[];
  const liveCount = leads.filter((lead) => isLiveLike(lead.status)).length;

  // One query for every event rather than one per live lead: the whole
  // pipeline is at most 260 rows, so the comment log is small enough to
  // pull whole and group in memory.
  const liveIds = leads.filter((lead) => isLiveLike(lead.status)).map((l) => l.id);

  const { data: eventRows } = liveIds.length
    ? await supabase
        .from("pipeline_comment_events")
        .select("*")
        .eq("user_id", userId)
        .in("pipeline_lead_id", liveIds)
        .order("at", { ascending: false })
    : { data: [] as CommentEventRow[] };

  const eventsByLead = new Map<string, CommentEventRow[]>();
  for (const event of (eventRows ?? []) as CommentEventRow[]) {
    const list = eventsByLead.get(event.pipeline_lead_id) ?? [];
    list.push(event);
    eventsByLead.set(event.pipeline_lead_id, list);
  }

  const board: PipelineBoard = {
    waitlist: [],
    live: [],
    backlog: [],
    liveCount,
    liveCap,
  };

  for (const lead of leads) {
    const lane = laneFor(lead.status);
    if (lane === "hidden") continue;

    const suggestion = suggestionFor(lead, now);
    const card: PipelineCard = {
      lead,
      suggestion,
      replaceSuggested: shouldSuggestReplace(suggestion, liveCount, liveCap),
      nextAction: nextActionFor(lead, liveCount, liveCap, now),
      events: eventsByLead.get(lead.id) ?? [],
    };

    board[lane].push(card);
  }

  // Waitlist order is the order Replace pulls from: oldest ICP-yes first,
  // so "pick next" and the column agree about who is at the top.
  board.waitlist.sort((a, b) => {
    const aYes = a.lead.icp === "yes" ? 0 : 1;
    const bYes = b.lead.icp === "yes" ? 0 : 1;
    if (aYes !== bYes) return aYes - bYes;
    return Date.parse(a.lead.created_at) - Date.parse(b.lead.created_at);
  });

  // Live: whatever needs a decision floats up.
  const URGENCY: Record<NextAction["kind"], number> = {
    replace: 0,
    pitch: 1,
    follow_up: 2,
    comment: 3,
    wait: 4,
  };
  board.live.sort(
    (a, b) => URGENCY[a.nextAction.kind] - URGENCY[b.nextAction.kind],
  );

  // Backlog: most recently dropped first.
  board.backlog.sort(
    (a, b) => Date.parse(b.lead.updated_at) - Date.parse(a.lead.updated_at),
  );

  return board;
}
