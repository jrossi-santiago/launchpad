"use client";

import { useEffect, useState } from "react";
import type { ExploreQuery, RadarResult } from "@/lib/getx/search";
import { ResultCardSkeleton } from "@/components/radar/ResultCardSkeleton";
import {
  QuickCommentSheet,
  type DraftsState,
  type QuickDraft,
  type QuickTarget,
} from "@/components/mobile/QuickCommentSheet";

const MIN_FAVES = 20;
const RANGE_HOURS = 72;

// Explore is Radar with the search box already filled in. The chips come
// from the brand pack, so the tab opens on posts worth replying to instead
// of on an empty input — and every chip is an ordinary Radar search, which
// means the existing search cache makes a second tap on one free.
export function ExploreTab({
  chips,
  templates,
}: {
  chips: ExploreQuery[];
  templates: string[];
}) {
  const [activeChip, setActiveChip] = useState(0);
  const [results, setResults] = useState<RadarResult[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());

  const [target, setTarget] = useState<QuickTarget | null>(null);
  const [drafts, setDrafts] = useState<QuickDraft[]>([]);
  const [draftsState, setDraftsState] = useState<DraftsState>("idle");
  const [draftsError, setDraftsError] = useState<string | null>(null);

  // Promise chain rather than async/await, to match RadarSearch: the
  // setState-in-effect lint rule traces through async functions but not
  // .then() chains.
  function search(query: string) {
    fetch("/api/radar/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        min_faves: MIN_FAVES,
        range_hours: RANGE_HOURS,
        product: "Top",
        cursor: "",
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Search failed (${response.status}).`);
        }
        setResults((body?.results ?? []) as RadarResult[]);
        setStatus("idle");
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to search.");
      });
  }

  useEffect(() => {
    // Fires once on mount with the first chip; tapping a chip searches
    // again. status already starts as "loading".
    if (chips.length > 0) search(chips[0].query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChip(index: number) {
    if (index === activeChip || status === "loading") return;
    setActiveChip(index);
    setStatus("loading");
    setError(null);
    search(chips[index].query);
  }

  function openSheet(result: RadarResult) {
    setTarget({
      xTweetId: result.x_tweet_id,
      authorHandle: result.author_handle,
      content: result.content,
      fetched: result,
    });
    setDrafts([]);
    setDraftsState("idle");
    setDraftsError(null);
  }

  // Identical pair of awaited requests to the ones Radar makes on Add:
  // put the post in the queue, then write drafts for it.
  async function queueAndDraft(result: RadarResult): Promise<QuickDraft[]> {
    const addResponse = await fetch("/api/radar/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x_tweet_id: result.x_tweet_id,
        author_handle: result.author_handle,
        content: result.content,
        url: result.url,
        metrics: result.metrics,
        engagement_score: result.engagement_score,
      }),
    });
    const addBody = await addResponse.json().catch(() => null);
    if (!addResponse.ok) {
      throw new Error(addBody?.error ?? "Couldn't add that post to your Queue.");
    }

    const tweetId = addBody?.tweet?.id as string | undefined;
    if (!tweetId) throw new Error("Couldn't add that post to your Queue.");

    setQueuedIds((prev) => new Set(prev).add(result.x_tweet_id));

    const draftResponse = await fetch("/api/drafts/regenerate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    const draftBody = await draftResponse.json().catch(() => null);
    if (!draftResponse.ok) {
      throw new Error(draftBody?.error ?? "Couldn't write drafts for that post.");
    }

    return ((draftBody?.drafts ?? []) as { id: string; draft_text: string | null }[])
      .filter((draft) => Boolean(draft.draft_text))
      .map((draft) => ({ id: draft.id, text: draft.draft_text as string }));
  }

  async function handleRequestDrafts() {
    const result = target?.fetched as RadarResult | undefined;
    if (!result) return;

    setDraftsState("working");
    setDraftsError(null);
    try {
      setDrafts(await queueAndDraft(result));
      setDraftsState("ready");
    } catch (err) {
      setDraftsState("failed");
      setDraftsError(
        err instanceof Error ? err.message : "Couldn't write drafts for that post.",
      );
    }
  }

  async function handleQueue(result: RadarResult) {
    setError(null);
    try {
      await queueAndDraft(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't queue that post.");
    }
  }

  async function handleMarkPosted(draftId: string) {
    await fetch("/api/drafts/mark-posted", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_id: draftId }),
    }).catch(() => null);
  }

  if (chips.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No searches to explore yet.
        </p>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Fill in who your customer is on Home and these searches build
          themselves from it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Explore
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Searches built from your brand pack. Strangers worth replying to.
        </p>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {chips.map((chip, index) => (
          <button
            key={chip.query}
            type="button"
            onClick={() => handleChip(index)}
            aria-pressed={index === activeChip}
            disabled={status === "loading" && index !== activeChip}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60 ${
              index === activeChip
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      ) : null}

      {status === "loading" ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ResultCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nothing matched that search in the last three days.
          </p>
          <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            Try another chip, or widen the search on Radar.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {results.map((result) => (
            <article
              key={result.x_tweet_id}
              className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {result.author_handle}
                </span>
                {result.url ? (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
                  >
                    X ↗
                  </a>
                ) : null}
              </div>

              <p className="self-start rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {result.whyItMatched}
              </p>

              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                {result.content}
              </p>

              <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{result.metrics.like_count} likes</span>
                <span>{result.metrics.retweet_count} retweets</span>
                <span>{result.metrics.reply_count} replies</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openSheet(result)}
                  className="min-h-11 flex-1 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Reply
                </button>
                <button
                  type="button"
                  onClick={() => void handleQueue(result)}
                  disabled={
                    result.alreadySaved || queuedIds.has(result.x_tweet_id)
                  }
                  className="min-h-11 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {result.alreadySaved || queuedIds.has(result.x_tweet_id)
                    ? "Queued"
                    : "Queue"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <QuickCommentSheet
        target={target}
        templates={templates}
        drafts={drafts}
        draftsState={draftsState}
        draftsError={draftsError}
        onRequestDrafts={() => void handleRequestDrafts()}
        onMarkPosted={(draftId) => void handleMarkPosted(draftId)}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
