"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";

export function TweetCard({
  tweet,
  drafts,
}: {
  tweet: TweetRow;
  drafts: DraftRow[];
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {tweet.author_handle ?? "Unknown author"}
          </p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            {tweet.content}
          </p>
          <div className="mt-2 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{metrics.like_count ?? 0} likes</span>
            <span>{metrics.retweet_count ?? 0} retweets</span>
            <span>{metrics.reply_count ?? 0} replies</span>
          </div>
        </div>
        {tweet.url ? (
          <a
            href={tweet.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            View on X →
          </a>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
    </div>
  );
}
