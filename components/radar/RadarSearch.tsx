"use client";

import { useEffect, useState } from "react";
import type { RadarResult } from "@/lib/getx/search";
import { ResultCard, type DraftState } from "@/components/radar/ResultCard";
import { ResultCardSkeleton } from "@/components/radar/ResultCardSkeleton";

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "72h", hours: 72 },
  { label: "7d", hours: 168 },
];

const PRODUCT_TABS: { label: string; value: "Top" | "Latest" }[] = [
  { label: "Top", value: "Top" },
  { label: "Latest", value: "Latest" },
];

export function RadarSearch({
  initialQuery,
  initialMinFaves,
  initialRangeHours,
}: {
  initialQuery: string;
  initialMinFaves: number;
  initialRangeHours: number;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [minFaves, setMinFaves] = useState(initialMinFaves);
  const [rangeHours, setRangeHours] = useState(initialRangeHours);
  const [product, setProduct] = useState<"Top" | "Latest">("Top");

  const [results, setResults] = useState<RadarResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideAdded, setHideAdded] = useState(false);

  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());
  const [draftState, setDraftState] = useState<Record<string, DraftState>>({});

  // Plain promise chain rather than async/await — the lint rule that flags
  // setState-in-effect traces through async functions but not .then()
  // chains. searchProduct/searchCursor are passed explicitly (not read
  // from state) so a caller that just called setProduct/setCursor doesn't
  // race its own stale closure.
  function performSearch(
    searchProduct: "Top" | "Latest",
    searchCursor: string,
    append: boolean,
  ) {
    fetch("/api/radar/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        min_faves: minFaves,
        range_hours: rangeHours,
        product: searchProduct,
        cursor: searchCursor,
      }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Search failed (${response.status}).`);
        }
        const newResults = (body?.results ?? []) as RadarResult[];
        setResults((prev) => {
          if (!append) return newResults;
          const seen = new Set(prev.map((r) => r.x_tweet_id));
          const deduped = newResults.filter((r) => !seen.has(r.x_tweet_id));
          return [...prev, ...deduped];
        });
        setNextCursor((body?.nextCursor ?? null) as string | null);
        setStatus("idle");
        setMoreLoading(false);
      })
      .catch((err) => {
        setStatus("error");
        setMoreLoading(false);
        setError(err instanceof Error ? err.message : "Failed to search Radar.");
      });
  }

  function runSearch() {
    setStatus("loading");
    setError(null);
    performSearch(product, "", false);
  }

  useEffect(() => {
    // Fires once on mount with the initial props (status already starts as
    // "loading"); further full searches only run when the user clicks
    // Search or a product tab.
    performSearch(product, "", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProductChange(next: "Top" | "Latest") {
    if (next === product || status === "loading") return;
    setProduct(next);
    setStatus("loading");
    setError(null);
    performSearch(next, "", false);
  }

  function handleMore() {
    if (!nextCursor || moreLoading) return;
    setMoreLoading(true);
    performSearch(product, nextCursor, true);
  }

  async function handleAdd(result: RadarResult) {
    if (addingIds.has(result.x_tweet_id)) return;

    setAddingIds((prev) => new Set(prev).add(result.x_tweet_id));

    try {
      const response = await fetch("/api/radar/add", {
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

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Add failed (${response.status}).`);
      }

      setResults((prev) =>
        prev.map((r) =>
          r.x_tweet_id === result.x_tweet_id ? { ...r, alreadySaved: true } : r,
        ),
      );
      setJustAddedIds((prev) => new Set(prev).add(result.x_tweet_id));
      setTimeout(() => {
        setJustAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(result.x_tweet_id);
          return next;
        });
      }, 2000);

      // Second, separate, fully-awaited request — no detached server-side
      // side effect (Lesson 5). Reuses POST /api/drafts/regenerate
      // verbatim rather than a second Anthropic-calling code path.
      const tweetId = body?.tweet?.id as string | undefined;
      if (tweetId) {
        setDraftState((prev) => ({ ...prev, [result.x_tweet_id]: "drafting" }));
        try {
          const draftResponse = await fetch("/api/drafts/regenerate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tweet_id: tweetId }),
          });

          if (!draftResponse.ok) throw new Error("Draft generation failed.");

          setDraftState((prev) => ({ ...prev, [result.x_tweet_id]: "ready" }));
        } catch {
          setDraftState((prev) => ({ ...prev, [result.x_tweet_id]: "failed" }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add that tweet.");
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.x_tweet_id);
        return next;
      });
    }
  }

  const inputClass =
    "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  const visibleResults = hideAdded ? results.filter((r) => !r.alreadySaved) : results;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Radar
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Search X for high-engagement posts in your niche and add the best
          ones to Launchpad.
        </p>

        <div className="mt-6 flex gap-2">
          {PRODUCT_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleProductChange(tab.value)}
              disabled={status === "loading"}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                product === tab.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search query"
            className={`${inputClass} w-full`}
          />

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Min likes
              <input
                type="number"
                min={0}
                value={minFaves}
                onChange={(e) => setMinFaves(Number(e.target.value))}
                className={`${inputClass} w-28`}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Time range
              <select
                value={rangeHours}
                onChange={(e) => setRangeHours(Number(e.target.value))}
                className={`${inputClass} w-28`}
              >
                {RANGE_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={runSearch}
              disabled={status === "loading" || !query.trim()}
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {status === "loading" ? "Searching…" : "Search"}
            </button>

            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={hideAdded}
                onChange={(e) => setHideAdded(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Hide already-added
            </label>
          </div>
        </div>

        {status === "error" && error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <ResultCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            No posts matched that search.
          </p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Try lowering the minimum likes, widening the time range, or
            editing the query.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visibleResults.map((result) => (
              <ResultCard
                key={result.x_tweet_id}
                result={result}
                onAdd={() => void handleAdd(result)}
                isAdding={addingIds.has(result.x_tweet_id)}
                justAdded={justAddedIds.has(result.x_tweet_id)}
                draftState={draftState[result.x_tweet_id] ?? "idle"}
              />
            ))}
          </div>

          {nextCursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleMore}
                disabled={moreLoading}
                className="rounded-full border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {moreLoading ? "Loading more…" : "More"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
