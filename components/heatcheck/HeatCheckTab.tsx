"use client";

import { useEffect, useRef, useState } from "react";
import { TypeChip } from "@/components/comment/TypeChip";
import { CtaToggle } from "@/components/comment/CtaToggle";
import { withCta } from "@/lib/x/intent";
import type { HeatCheckCard, HeatCheckKind } from "@/lib/anthropic/heatcheck";
import type { HeatCheckUsage } from "@/lib/usage/heatChecks";

// What one press actually costs in wall-clock: a GetXAPI search, then ten
// Sonnet reads five at a time. Two waves of a model that thinks before
// it writes lands around eighteen seconds, and a spinner sitting there
// for eighteen seconds reads as broken. So the wait gets a bar with a
// number on it, easing towards — never reaching — the end, and snapping
// shut when the response actually lands. It is an estimate presented as
// an estimate, not a real measurement of progress; the run finishing is
// what ends it.
const ESTIMATED_MS = 18_000;
const CEILING = 0.92;
const TICK_MS = 100;

const KIND_LABEL: Record<HeatCheckKind, string> = {
  value: "Value add",
  grok: "Grok question",
  pitch: "Pitch",
};

const KIND_CLASS: Record<HeatCheckKind, string> = {
  value:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  grok: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  pitch:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

const STAGES = [
  "Searching the last 24 hours…",
  "Ranking what's actually performing…",
  "Sonnet is reading each post…",
  "Writing your comments…",
];

export function HeatCheckTab({
  defaultNiche,
  initialUsage,
}: {
  defaultNiche: string;
  initialUsage: HeatCheckUsage;
}) {
  const [niche, setNiche] = useState(defaultNiche);
  const [usage, setUsage] = useState(initialUsage);
  const [cards, setCards] = useState<HeatCheckCard[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  // Which cards are currently showing their CTA. Per card, and reset by a
  // new run along with the cards themselves.
  const [ctaOn, setCtaOn] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);

  // Leaving the tab is meant to be the end of it: the run in flight is
  // abandoned, and because the cards only ever lived in this component's
  // state, coming back finds an empty page and the button again.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (status !== "running") return;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Eases out, so the bar is quick at the start and crawls near the
      // end — a run that overshoots the estimate keeps inching rather
      // than sitting frozen at full.
      setProgress(CEILING * (1 - Math.exp(-elapsed / (ESTIMATED_MS / 2.5))));
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [status]);

  function run() {
    const query = niche.trim();
    if (!query || status === "running" || usage.remaining <= 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("running");
    setError(null);
    setCards([]);
    setProgress(0);
    setCopiedId(null);

    fetch("/api/heatcheck/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ niche: query }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (body?.usage) setUsage(body.usage as HeatCheckUsage);
        if (!response.ok) {
          throw new Error(body?.error ?? `HeatCheck failed (${response.status}).`);
        }
        setCards((body?.cards ?? []) as HeatCheckCard[]);
        setCtaOn(new Set());
        setProgress(1);
        setStatus("done");
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "HeatCheck failed.");
        setStatus("error");
      });
  }

  function toggleCta(id: string) {
    setCtaOn((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // What gets copied is what the card is showing — comment alone, or
  // comment plus the CTA the founder turned on.
  async function copy(card: HeatCheckCard) {
    try {
      await navigator.clipboard.writeText(
        withCta(
          card.read.comment,
          ctaOn.has(card.x_tweet_id) ? card.read.cta : null,
        ),
      );
      setCopiedId(card.x_tweet_id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Couldn't copy that — select the text and copy it manually.");
    }
  }

  async function queue(card: HeatCheckCard) {
    setError(null);
    try {
      const response = await fetch("/api/radar/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x_tweet_id: card.x_tweet_id,
          author_handle: card.author_handle,
          content: card.content,
          url: card.url,
          metrics: card.metrics,
          engagement_score: card.engagement_score,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Couldn't add that post to your Queue.");
      }
      setQueuedIds((prev) => new Set(prev).add(card.x_tweet_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't queue that post.");
    }
  }

  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length))];
  const spent = usage.remaining <= 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          HeatCheck
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The posts winning in your niche right now, and one comment for each.
          Nothing runs until you press the button.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label
          htmlFor="heatcheck-niche"
          className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
        >
          Your niche
        </label>
        <input
          id="heatcheck-niche"
          value={niche}
          onChange={(event) => setNiche(event.target.value)}
          disabled={status === "running"}
          placeholder="e.g. b2b saas founders"
          className="min-h-11 rounded-xl border border-zinc-300 px-3 text-[15px] text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Pulled from your Brand Pack. Edit it to check a different corner of
          the market.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={status === "running" || !niche.trim() || spent}
          className="min-h-12 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {status === "running" ? "Running HeatCheck…" : "Run HeatCheck"}
        </button>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {spent
            ? "All three used today. They reset at midnight UTC."
            : `${usage.remaining} of ${usage.limit} left today.`}
        </p>
      </div>

      {status === "running" ? (
        <div
          className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {stage}
            </span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-900 transition-[width] duration-100 ease-linear dark:bg-zinc-50"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Reading ten posts properly takes around twenty seconds. Leaving the
            tab cancels it.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      ) : null}

      {status === "done" && cards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nothing caught fire in that niche today.
          </p>
          <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            Try a broader wording of your niche — that press didn&apos;t count
            against your three.
          </p>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <article
              key={card.x_tweet_id}
              className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {card.author_handle}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLASS[card.read.kind]}`}
                >
                  {KIND_LABEL[card.read.kind]}
                </span>
                {/* Which of the four a value comment is. grok and pitch
                    are their own shapes and carry no type. */}
                <TypeChip type={card.read.commentType} />
                {card.url ? (
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
                  >
                    X ↗
                  </a>
                ) : null}
              </div>

              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                {card.content}
              </p>

              <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{card.metrics.like_count} likes</span>
                <span>{card.metrics.retweet_count} retweets</span>
                <span>{card.metrics.reply_count} replies</span>
              </div>

              <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-50">
                  {card.read.comment}
                </p>
                <CtaToggle
                  cta={card.read.cta}
                  on={ctaOn.has(card.x_tweet_id)}
                  onToggle={() => toggleCta(card.x_tweet_id)}
                />
                {/* What the comment adds, in the model's own words. The
                    thing to disagree with before this goes under a post
                    thousands of people are reading. */}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium">Adds:</span> {card.read.point}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {card.read.why}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy(card)}
                  className="min-h-11 flex-1 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {copiedId === card.x_tweet_id ? "Copied" : "Copy comment"}
                </button>
                <button
                  type="button"
                  onClick={() => void queue(card)}
                  disabled={queuedIds.has(card.x_tweet_id)}
                  className="min-h-11 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {queuedIds.has(card.x_tweet_id) ? "Queued" : "Queue"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
