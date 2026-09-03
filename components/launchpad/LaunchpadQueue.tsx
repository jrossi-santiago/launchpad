"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";
import type { RegenerationUsage } from "@/lib/usage/regenerations";
import { TweetCard } from "@/components/launchpad/TweetCard";
import { UsageMeter } from "@/components/launchpad/UsageMeter";

export type QueueItem = {
  tweet: TweetRow;
  drafts: DraftRow[];
};

export function LaunchpadQueue({
  initialItems,
  initialUsage,
}: {
  initialItems: QueueItem[];
  initialUsage: RegenerationUsage;
}) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [usage, setUsage] = useState<RegenerationUsage>(initialUsage);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Record<string, string>>({});

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    if (!input.trim() || status === "loading") return;

    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/tweets/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Fetch failed (${response.status}).`);
      }

      const { tweet, drafts } = body as QueueItem;

      setItems((prev) => [
        { tweet, drafts },
        ...prev.filter((item) => item.tweet.id !== tweet.id),
      ]);
      setInput("");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to fetch that tweet.",
      );
    }
  }

  function toggleExpanded(tweetId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tweetId)) next.delete(tweetId);
      else next.add(tweetId);
      return next;
    });
  }

  async function handleRegenerate(tweetId: string) {
    if (regeneratingIds.has(tweetId)) return;

    setRegeneratingIds((prev) => new Set(prev).add(tweetId));
    setRegenerateErrors((prev) => {
      const next = { ...prev };
      delete next[tweetId];
      return next;
    });

    try {
      const response = await fetch("/api/drafts/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet_id: tweetId }),
      });

      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        if (body?.usage) setUsage(body.usage as RegenerationUsage);
        setRegenerateErrors((prev) => ({
          ...prev,
          [tweetId]: body?.error ?? "You've hit today's regeneration limit.",
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error ?? `Regenerate failed (${response.status}).`);
      }

      const { drafts, usage: nextUsage } = body as {
        drafts: DraftRow[];
        usage: RegenerationUsage;
      };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.id === tweetId ? { ...item, drafts } : item,
        ),
      );
      setUsage(nextUsage);
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [tweetId]:
          err instanceof Error ? err.message : "Failed to regenerate drafts.",
      }));
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  async function handleDelete(tweetId: string) {
    if (deletingIds.has(tweetId)) return;

    setDeletingIds((prev) => new Set(prev).add(tweetId));

    try {
      const response = await fetch(`/api/tweets/${tweetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${response.status}).`);
      }

      setItems((prev) => prev.filter((item) => item.tweet.id !== tweetId));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [tweetId]:
          err instanceof Error ? err.message : "Failed to delete that tweet.",
      }));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Launchpad
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Paste a tweet URL or ID to fetch it and generate 3 on-voice reply
          drafts.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleFetch();
            }}
            placeholder="https://x.com/handle/status/1234567890 or 1234567890"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void handleFetch()}
            disabled={status === "loading"}
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {status === "loading" ? "Fetching…" : "Fetch"}
          </button>
        </div>
        {status === "error" && error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            No tweets in your queue yet.
          </p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Paste a tweet URL or ID above to add one, or pull high-engagement
            posts in from Radar —{" "}
            <span className="font-medium">coming soon</span>.
          </p>
        </div>
      ) : (
        <>
          <UsageMeter usage={usage} />
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <div key={item.tweet.id} className="flex flex-col gap-2">
                <TweetCard
                  tweet={item.tweet}
                  drafts={item.drafts}
                  expanded={expandedIds.has(item.tweet.id)}
                  onToggle={() => toggleExpanded(item.tweet.id)}
                  onRegenerate={() => void handleRegenerate(item.tweet.id)}
                  isRegenerating={regeneratingIds.has(item.tweet.id)}
                  canRegenerate={usage.remaining > 0}
                  onDelete={() => void handleDelete(item.tweet.id)}
                  isDeleting={deletingIds.has(item.tweet.id)}
                />
                {regenerateErrors[item.tweet.id] ? (
                  <p className="px-2 text-sm text-red-600 dark:text-red-400">
                    {regenerateErrors[item.tweet.id]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
