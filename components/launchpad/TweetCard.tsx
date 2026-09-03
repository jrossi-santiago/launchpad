"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";

const STATUS_LABELS: Record<string, string> = {
  queued: "queued",
  drafted: "drafted",
  actioned: "actioned",
  dismissed: "dismissed",
};

export function TweetCard({
  tweet,
  drafts,
  expanded,
  onToggle,
  onRegenerate,
  isRegenerating,
  canRegenerate,
  onDelete,
  isDeleting,
}: {
  tweet: TweetRow;
  drafts: DraftRow[];
  expanded: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  canRegenerate: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleCopy(draft: DraftRow) {
    if (!draft.draft_text) return;
    try {
      await navigator.clipboard.writeText(draft.draft_text);
      setCopiedId(draft.id);
      setTimeout(() => {
        setCopiedId((current) => (current === draft.id ? null : current));
      }, 1500);
    } catch {
      // Clipboard access denied or unavailable in this browser context.
    }
  }

  const metrics = tweet.metrics ?? {
    like_count: 0,
    retweet_count: 0,
    reply_count: 0,
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-6 py-4 text-left"
      >
        <span
          className={`shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="w-32 shrink-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {tweet.author_handle ?? "Unknown author"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
          {tweet.content ?? ""}
        </span>
        <span className="hidden shrink-0 gap-3 text-xs text-zinc-500 dark:text-zinc-400 sm:flex">
          <span>{metrics.like_count ?? 0} likes</span>
          <span>{metrics.retweet_count ?? 0} retweets</span>
          <span>{metrics.reply_count ?? 0} replies</span>
        </span>
        <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {STATUS_LABELS[tweet.status] ?? tweet.status}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-zinc-200 px-6 py-5 dark:border-zinc-800">
          {tweet.url ? (
            <a
              href={tweet.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              View on X →
            </a>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <p className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">
                  {draft.draft_text}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {(draft.draft_text ?? "").length}/280
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(draft)}
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    {copiedId === draft.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isRegenerating || !canRegenerate}
              title={
                canRegenerate
                  ? undefined
                  : "You've hit today's regeneration limit."
              }
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isRegenerating ? "Regenerating…" : "Regenerate"}
            </button>

            {confirmingDelete ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <span>Delete this tweet and its drafts?</span>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="rounded-full bg-amber-800 px-3 py-1 font-medium text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                >
                  {isDeleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-full px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
