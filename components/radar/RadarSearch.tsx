"use client";

import { useEffect, useState } from "react";
import type { RadarResult } from "@/lib/getx/search";
import { ResultCard } from "@/components/radar/ResultCard";

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "72h", hours: 72 },
  { label: "7d", hours: 168 },
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

  const [results, setResults] = useState<RadarResult[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());

  // Plain promise chain rather than async/await — the lint rule that flags
  // setState-in-effect (needed below, since the search fires on mount)
  // traces through async functions but not .then() chains.
  function performSearch() {
    fetch("/api/radar/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, min_faves: minFaves, range_hours: rangeHours }),
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
        setError(err instanceof Error ? err.message : "Failed to search Radar.");
      });
  }

  function runSearch() {
    setStatus("loading");
    setError(null);
    performSearch();
  }

  useEffect(() => {
    // Fires once on mount with the initial props (status already starts as
    // "loading"); further searches only run when the user clicks Search.
    performSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <div className="mt-6 flex flex-col gap-3">
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
          </div>
        </div>

        {status === "error" && error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Searching…</p>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {results.map((result) => (
            <ResultCard
              key={result.x_tweet_id}
              result={result}
              onAdd={() => void handleAdd(result)}
              isAdding={addingIds.has(result.x_tweet_id)}
              justAdded={justAddedIds.has(result.x_tweet_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
