"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedCard } from "@/lib/network/stack";
import { formatAge } from "@/components/network/NetworkCard";
import {
  QuickCommentSheet,
  type DraftsState,
  type QuickDraft,
  type QuickTarget,
} from "@/components/mobile/QuickCommentSheet";

// How far you have to drag the top of the stream down before it re-polls.
const PULL_THRESHOLD = 70;

type CardState = "live" | "liking" | "liked" | "gone";

export function FeedStream({
  initialFeed,
  hasProfiles,
  templates,
  xConnected,
  initialError = null,
}: {
  initialFeed: FeedCard[];
  // Whether any accounts are being watched at all. An empty stream means
  // two different things — nothing to watch, or nothing new from what you
  // watch — and only one of them is worth polling for.
  hasProfiles: boolean;
  templates: string[];
  xConnected: boolean;
  initialError?: string | null;
}) {
  const [feed, setFeed] = useState<FeedCard[]>(initialFeed);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const [pull, setPull] = useState(0);

  const [target, setTarget] = useState<QuickTarget | null>(null);
  const [drafts, setDrafts] = useState<QuickDraft[]>([]);
  const [draftsState, setDraftsState] = useState<DraftsState>("idle");
  const [draftsError, setDraftsError] = useState<string | null>(null);

  const pullStart = useRef<number | null>(null);

  // Same endpoint, same poll TTL, as the desktop board: a page load leaves
  // recently-polled accounts alone, and a pull sends force. Written as a
  // promise chain to match NetworkBoard (the setState-in-effect lint rule
  // traces through async functions but not .then() chains).
  const refresh = useCallback((force = false) => {
    fetch("/api/network/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `Refresh failed (${response.status}).`);
        }
        setFeed((body?.feed ?? []) as FeedCard[]);
        setCardStates({});
        setRefreshing(false);
      })
      .catch((err) => {
        setRefreshing(false);
        setError(err instanceof Error ? err.message : "Failed to refresh your Feed.");
      });
  }, []);

  useEffect(() => {
    // Fires once, on page load — nothing else polls. Polls on an empty
    // stream too, as long as there are accounts to poll: a first visit
    // has no cards yet, and that is exactly when one is worth fetching.
    if (hasProfiles) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRefreshClick() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    refresh(true);
  }

  // Pull to refresh, done with the page's own scroll position: the drag
  // only counts when the stream is already at the top, so it never fights
  // an ordinary scroll.
  function onTouchStart(event: React.TouchEvent) {
    pullStart.current = window.scrollY <= 0 ? event.touches[0].clientY : null;
  }

  function onTouchMove(event: React.TouchEvent) {
    if (pullStart.current === null || refreshing) return;
    const distance = event.touches[0].clientY - pullStart.current;
    setPull(distance > 0 ? Math.min(distance, PULL_THRESHOLD + 20) : 0);
  }

  function onTouchEnd() {
    if (pull >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setError(null);
      refresh(true);
    }
    pullStart.current = null;
    setPull(0);
  }

  function setCardState(cardId: string, state: CardState) {
    setCardStates((prev) => ({ ...prev, [cardId]: state }));
  }

  async function handleSkip(card: FeedCard) {
    setCardState(card.id, "gone");
    // The row stays in the table with its state flipped — that's what
    // stops the next poll from putting it back on top.
    const response = await fetch("/api/network/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card_id: card.id }),
    }).catch(() => null);

    if (!response || !response.ok) {
      setCardState(card.id, "live");
      setError("Couldn't skip that post. It's still in your Feed.");
      return;
    }

    setFeed((prev) => prev.filter((item) => item.id !== card.id));
  }

  async function handleLike(card: FeedCard) {
    if (cardStates[card.id] === "liking" || cardStates[card.id] === "liked") return;
    setCardState(card.id, "liking");
    setError(null);

    try {
      const response = await fetch("/api/tweets/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: card.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to like that post.");
      // A like isn't a decision to stop replying, so the card stays put.
      setCardState(card.id, "liked");
    } catch (err) {
      setCardState(card.id, "live");
      setError(err instanceof Error ? err.message : "Failed to like that post.");
    }
  }

  function openSheet(card: FeedCard) {
    setTarget({
      xTweetId: card.x_tweet_id,
      authorHandle: `@${card.handle}`,
      content: card.content ?? "",
      cardId: card.id,
    });
    setDrafts([]);
    setDraftsState("idle");
    setDraftsError(null);
  }

  // Two fully-awaited requests, the same pair Radar and the desktop board
  // make: put the post in the queue, then write drafts for it. Sending is
  // what takes the card out of the Feed — the templates above needed
  // neither call.
  async function handleRequestDrafts() {
    if (!target?.cardId) return;
    const cardId = target.cardId;
    setDraftsState("working");
    setDraftsError(null);

    try {
      const sendResponse = await fetch("/api/network/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: cardId }),
      });
      const sendBody = await sendResponse.json().catch(() => null);
      if (!sendResponse.ok) {
        throw new Error(sendBody?.error ?? "Couldn't add that post to your Queue.");
      }

      const tweetId = sendBody?.tweet?.id as string | undefined;
      if (!tweetId) throw new Error("Couldn't add that post to your Queue.");

      const draftResponse = await fetch("/api/drafts/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet_id: tweetId }),
      });
      const draftBody = await draftResponse.json().catch(() => null);
      if (!draftResponse.ok) {
        throw new Error(draftBody?.error ?? "Couldn't write drafts for that post.");
      }

      const written = ((draftBody?.drafts ?? []) as { id: string; draft_text: string | null }[])
        .filter((draft) => Boolean(draft.draft_text))
        .map((draft) => ({ id: draft.id, text: draft.draft_text as string }));

      setDrafts(written);
      setDraftsState("ready");
      setFeed((prev) => prev.filter((item) => item.id !== cardId));
    } catch (err) {
      setDraftsState("failed");
      setDraftsError(
        err instanceof Error ? err.message : "Couldn't write drafts for that post.",
      );
    }
  }

  async function handleMarkPosted(draftId: string) {
    await fetch("/api/drafts/mark-posted", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft_id: draftId }),
    }).catch(() => null);
  }

  const visible = feed.filter((card) => cardStates[card.id] !== "gone");

  return (
    <div
      className="flex flex-1 flex-col gap-4"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Feed
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every account you watch, newest first. Reply, like, or skip.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshClick}
          disabled={refreshing}
          className="min-h-11 shrink-0 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {pull > 0 || refreshing ? (
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
          {refreshing
            ? "Polling your accounts…"
            : pull >= PULL_THRESHOLD
              ? "Release to refresh"
              : "Pull to refresh"}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {hasProfiles ? "Nothing left to reply to." : "No accounts to watch yet."}
          </p>
          <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            {hasProfiles
              ? "You've dealt with everything your accounts posted. Try Explore for strangers worth replying to."
              : "Add the accounts you want to reply to on Network, and their posts show up here."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((card) => {
            const state = cardStates[card.id] ?? "live";
            return (
              <article
                key={card.id}
                className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {card.handle.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {card.display_name ?? card.handle}
                    </span>
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      @{card.handle}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {formatAge(card.posted_at)}
                  </span>
                </div>

                <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                  {card.content ?? ""}
                </p>

                {card.quoted ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/50">
                    <p className="flex items-baseline gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span aria-hidden>↱</span>
                      <span className="truncate">@{card.quoted.handle}</span>
                    </p>
                    <p className="mt-1 line-clamp-4 text-xs leading-relaxed whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                      {card.quoted.text}
                    </p>
                  </div>
                ) : null}

                <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{card.metrics.like_count} likes</span>
                  <span>{card.metrics.retweet_count} retweets</span>
                  <span>{card.metrics.reply_count} replies</span>
                  {card.url ? (
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
                    >
                      X ↗
                    </a>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openSheet(card)}
                    className="min-h-11 flex-1 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLike(card)}
                    disabled={!xConnected || state === "liking" || state === "liked"}
                    aria-label={state === "liked" ? "Liked" : "Like this post"}
                    title={
                      xConnected
                        ? "Like as your account"
                        : "Connect X in Settings to like"
                    }
                    className={`min-h-11 min-w-11 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                      state === "liked"
                        ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                        : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {state === "liking" ? "…" : state === "liked" ? "♥" : "♡"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSkip(card)}
                    className="min-h-11 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Skip
                  </button>
                </div>
              </article>
            );
          })}
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
