"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";
import { TweetCard } from "@/components/launchpad/TweetCard";

export type QueueItem = {
  tweet: TweetRow;
  drafts: DraftRow[];
};

export function LaunchpadQueue({
  initialItems,
}: {
  initialItems: QueueItem[];
}) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
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
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No tweets fetched yet. Paste a URL above to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <TweetCard
              key={item.tweet.id}
              tweet={item.tweet}
              drafts={item.drafts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
