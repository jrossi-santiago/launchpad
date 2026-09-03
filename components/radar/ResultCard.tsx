import type { RadarResult } from "@/lib/getx/search";

export type DraftState = "idle" | "drafting" | "ready" | "failed";

const DRAFT_STATE_LABELS: Record<Exclude<DraftState, "idle">, string> = {
  drafting: "Drafting…",
  ready: "Drafted",
  failed: "Added — draft failed, retry from Launchpad",
};

export function ResultCard({
  result,
  onAdd,
  isAdding,
  justAdded,
  draftState,
}: {
  result: RadarResult;
  onAdd: () => void;
  isAdding: boolean;
  justAdded: boolean;
  draftState: DraftState;
}) {
  const metrics = result.metrics ?? {
    like_count: 0,
    retweet_count: 0,
    reply_count: 0,
  };
  const added = result.alreadySaved || justAdded;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {result.author_handle}
        </span>
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          View on X →
        </a>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{result.whyItMatched}</p>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {result.content.length > 240
          ? `${result.content.slice(0, 240)}…`
          : result.content}
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <span className="flex gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{metrics.like_count} likes</span>
          <span>{metrics.retweet_count} retweets</span>
          <span>{metrics.reply_count} replies</span>
        </span>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={onAdd}
            disabled={added || isAdding}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {added ? "Added" : isAdding ? "Adding…" : "Add to Launchpad"}
          </button>
          {added && draftState !== "idle" ? (
            <span
              className={`text-[11px] ${draftState === "failed" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}
            >
              {DRAFT_STATE_LABELS[draftState]}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
