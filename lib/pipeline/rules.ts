// The rules that decide what the pipeline SUGGESTS. Nothing here writes
// anything: every function is pure, takes the lead row and a clock, and
// returns a chip or a suggestion for the UI to render next to a button.
//
// The one thing that is enforced rather than suggested is the live cap —
// see canPromote below. Everything else is the user's call, because the
// whole point of the feature is that a person is doing the commenting.

export const LIVE_CAP = 10; // hard ceiling, never exceeded
export const DEFAULT_LIVE_CAP = 5; // what a new account works at
export const WAITLIST_CAP = 50;
export const BACKLOG_CAP = 200;

export const MAX_COMMENTS_WHILE_LIVE = 3;
export const MAX_DAYS_LIVE_NO_SIGNAL = 14;
export const MAX_DAYS_AFTER_ONE_REPLY = 7;
export const MAX_DAYS_AFTER_PITCH_NO_YES = 3;
export const MIN_DAYS_BETWEEN_COMMENTS_ON_SAME_LEAD = 2;

// The "three comments, no reply" cutoff. Distinct from
// MAX_DAYS_LIVE_NO_SIGNAL, which is the slower cutoff for someone you
// have only commented on once or twice.
export const MAX_DAYS_LIVE_AFTER_MAX_COMMENTS = 10;

// How many days a "Keep 7 days" press buys a lead.
export const KEEP_DAYS = 7;

export const DAY_MS = 24 * 60 * 60 * 1000;

export type PipelineStatus =
  | "new"
  | "waitlist"
  | "live"
  | "seen_you"
  | "conversation"
  | "pitched"
  | "converted"
  | "stale"
  | "backlog"
  | "skipped";

export type Icp = "yes" | "no" | "unrated";

export type PipelineLeadRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  bio_snippet: string | null;
  icp: Icp;
  source_post_url: string | null;
  source_type: string | null;
  lead_id: string | null;
  status: PipelineStatus;
  moved_to_live_at: string | null;
  last_our_comment_at: string | null;
  our_comment_count: number;
  their_reply_count: number;
  their_last_reply_at: string | null;
  last_signal_at: string | null;
  pitched_at: string | null;
  keep_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CommentEventRow = {
  id: string;
  pipeline_lead_id: string;
  our_comment_url: string | null;
  their_post_url: string | null;
  at: string;
  they_replied: boolean;
  their_reply_url: string | null;
};

const STATUSES: readonly PipelineStatus[] = [
  "new",
  "waitlist",
  "live",
  "seen_you",
  "conversation",
  "pitched",
  "converted",
  "stale",
  "backlog",
  "skipped",
];

export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isIcp(value: unknown): value is Icp {
  return value === "yes" || value === "no" || value === "unrated";
}

// Which column of the board a status sits in. Anything worked is "live";
// anything finished-for-now is "backlog".
export const LIVE_STATUSES: readonly PipelineStatus[] = [
  "live",
  "seen_you",
  "conversation",
  "pitched",
];

export function isLiveLike(status: PipelineStatus): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export type Lane = "waitlist" | "live" | "backlog" | "hidden";

export function laneFor(status: PipelineStatus): Lane {
  if (status === "waitlist") return "waitlist";
  if (isLiveLike(status)) return "live";
  if (status === "stale" || status === "backlog" || status === "skipped") {
    return "backlog";
  }
  // "new" is a lead that has been pulled but not triaged, and "converted"
  // is a win — neither belongs in one of the three working columns.
  return "hidden";
}

// The allowed moves, exactly as specified. Anything not listed is
// refused by the status route rather than silently applied, so a stale
// browser tab cannot walk a lead backwards.
const TRANSITIONS: Record<PipelineStatus, readonly PipelineStatus[]> = {
  new: ["waitlist", "skipped"],
  waitlist: ["live", "skipped"],
  live: ["seen_you", "conversation", "stale", "skipped", "waitlist"],
  seen_you: ["conversation", "stale", "waitlist"],
  conversation: ["pitched", "stale", "waitlist"],
  pitched: ["converted", "backlog", "skipped", "waitlist"],
  stale: ["backlog"],
  backlog: [],
  converted: [],
  skipped: [],
};

export function canTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  return (TRANSITIONS[from] as readonly string[]).includes(to);
}

export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (now - then) / DAY_MS;
}

// The effective working cap: what the user set, clamped to the hard
// ceiling. A cap of 0 or a junk value falls back to the default.
export function effectiveLiveCap(configured: number | null | undefined): number {
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return DEFAULT_LIVE_CAP;
  }
  return Math.min(LIVE_CAP, Math.max(1, Math.floor(configured)));
}

export type PromoteRefusal =
  | { ok: true }
  | { ok: false; reason: string };

// The one hard rule. Acceptance: you cannot have 11 live.
export function canPromote(liveCount: number, cap: number): PromoteRefusal {
  if (liveCount >= cap) {
    return {
      ok: false,
      reason: `You're already working ${liveCount} people. Replace one to free a slot.`,
    };
  }
  return { ok: true };
}

export type SuggestionKind = "stale" | "close" | "follow_up";

export type Suggestion = {
  kind: SuggestionKind;
  // What the row says when this fires.
  reason: string;
};

// Suggest STALE / CLOSE / FOLLOW_UP. Never applied automatically — the
// caller renders it next to a button.
export function suggestionFor(
  lead: PipelineLeadRow,
  now: number,
): Suggestion | null {
  // "Keep 7 days" suppresses everything until it runs out. It is a snooze
  // on the nagging, not a status.
  const keptFor = daysSince(lead.keep_until, now);
  if (keptFor !== null && keptFor < 0) return null;

  const daysLive = daysSince(lead.moved_to_live_at, now);
  const daysSinceReply = daysSince(lead.their_last_reply_at, now);
  const daysSincePitch = daysSince(lead.pitched_at, now);

  // Pitched and quiet: the only suggestion that asks for another touch
  // rather than an exit.
  if (
    lead.status === "pitched" &&
    daysSincePitch !== null &&
    daysSincePitch >= MAX_DAYS_AFTER_PITCH_NO_YES
  ) {
    return {
      kind: "follow_up",
      reason: `Pitched ${Math.floor(daysSincePitch)} days ago, no yes yet.`,
    };
  }

  // Three comments in, still nothing back.
  if (
    (lead.status === "live" || lead.status === "seen_you") &&
    lead.our_comment_count >= MAX_COMMENTS_WHILE_LIVE &&
    lead.their_reply_count === 0 &&
    daysLive !== null &&
    daysLive >= MAX_DAYS_LIVE_AFTER_MAX_COMMENTS
  ) {
    return {
      kind: "stale",
      reason: `${lead.our_comment_count} comments, no reply, ${Math.floor(daysLive)} days live.`,
    };
  }

  // The slower cutoff: even one comment, two weeks, nothing back.
  if (
    lead.status === "live" &&
    lead.our_comment_count >= 1 &&
    lead.their_reply_count === 0 &&
    daysLive !== null &&
    daysLive >= MAX_DAYS_LIVE_NO_SIGNAL
  ) {
    return {
      kind: "stale",
      reason: `${Math.floor(daysLive)} days live, no reply.`,
    };
  }

  // They spoke once and then went quiet.
  if (
    lead.status !== "pitched" &&
    lead.their_reply_count === 1 &&
    daysSinceReply !== null &&
    daysSinceReply >= MAX_DAYS_AFTER_ONE_REPLY
  ) {
    return {
      kind: "close",
      reason: `One reply, quiet for ${Math.floor(daysSinceReply)} days.`,
    };
  }

  return null;
}

// Replace is only worth raising when the room is nearly full — with slots
// to spare, a quiet lead costs nothing to keep.
export function shouldSuggestReplace(
  suggestion: Suggestion | null,
  liveCount: number,
  cap: number,
): boolean {
  if (!suggestion) return false;
  if (suggestion.kind === "follow_up") return false;
  return liveCount >= cap - 1;
}

export type NextAction =
  | { kind: "replace"; label: string; detail: string }
  | { kind: "follow_up"; label: string; detail: string }
  | { kind: "pitch"; label: string; detail: string }
  | { kind: "comment"; label: string; detail: string }
  | { kind: "wait"; label: string; detail: string };

// The chip on a live row. Order matters: an exit beats a nudge, a nudge
// beats routine work, and routine work beats waiting.
export function nextActionFor(
  lead: PipelineLeadRow,
  liveCount: number,
  cap: number,
  now: number,
): NextAction {
  const suggestion = suggestionFor(lead, now);

  if (shouldSuggestReplace(suggestion, liveCount, cap) && suggestion) {
    return {
      kind: "replace",
      label: "Replace suggested",
      detail: suggestion.reason,
    };
  }

  if (suggestion?.kind === "follow_up") {
    return { kind: "follow_up", label: "Follow up", detail: suggestion.reason };
  }

  // The pitch prompt is gated on them having actually spoken to us. With
  // zero replies this branch is unreachable, which is the point.
  if (lead.their_reply_count >= 1 && lead.status !== "pitched") {
    return {
      kind: "pitch",
      label: "They talked — pitch?",
      detail:
        lead.their_reply_count === 1
          ? "They replied to you once."
          : `They've replied ${lead.their_reply_count} times.`,
    };
  }

  if (suggestion?.kind === "stale" || suggestion?.kind === "close") {
    return { kind: "wait", label: "Going cold", detail: suggestion.reason };
  }

  if (lead.our_comment_count >= MAX_COMMENTS_WHILE_LIVE) {
    return {
      kind: "wait",
      label: "Wait",
      detail: `${MAX_COMMENTS_WHILE_LIVE} comments in — give them room.`,
    };
  }

  const sinceLast = daysSince(lead.last_our_comment_at, now);
  if (sinceLast !== null && sinceLast < MIN_DAYS_BETWEEN_COMMENTS_ON_SAME_LEAD) {
    const hoursLeft = Math.ceil(
      (MIN_DAYS_BETWEEN_COMMENTS_ON_SAME_LEAD - sinceLast) * 24,
    );
    return {
      kind: "wait",
      label: "Wait",
      detail: `Commented recently — ${hoursLeft}h until the next one.`,
    };
  }

  return {
    kind: "comment",
    label: "Comment",
    detail:
      lead.our_comment_count === 0
        ? "First comment on one of their posts."
        : `Comment ${lead.our_comment_count + 1} of ${MAX_COMMENTS_WHILE_LIVE}.`,
  };
}

// Offered only once they have replied at least once, which is what makes
// it a note rather than a cold DM. The user sends it themselves — nothing
// in this codebase opens a DM.
export const FOUR_SHAPE_NOTE = `1. What they said — quote the line of theirs that started this.
2. What it costs them — the version of the problem you heard underneath it.
3. What you built — one sentence, no feature list.
4. The small ask — a link, or "want me to send it over?" Nothing bigger.`;
