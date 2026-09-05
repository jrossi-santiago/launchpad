import type { NextAction, PipelineStatus } from "@/lib/pipeline/rules";

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  new: "New",
  waitlist: "Waitlist",
  live: "Live",
  seen_you: "Saw you",
  conversation: "Talking",
  pitched: "Pitched",
  converted: "Bought",
  stale: "Went cold",
  backlog: "Backlog",
  skipped: "Skipped",
};

export const ICP_LABELS: Record<string, string> = {
  yes: "ICP",
  no: "Not ICP",
  unrated: "Unrated",
};

// Replace shouts, the pitch prompt is warm, routine work is neutral and
// waiting is quiet — the colour is the whole point of the chip.
export const ACTION_CLASSES: Record<NextAction["kind"], string> = {
  replace:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  pitch:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  follow_up:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  comment:
    "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50",
  wait:
    "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800",
};

export function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";

  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

// Every pipeline route answers the same way: 200 with the row, or a
// non-200 with { error }. One helper so no component reinvents the
// error handling.
export async function postJson(
  url: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return body ?? {};
}
