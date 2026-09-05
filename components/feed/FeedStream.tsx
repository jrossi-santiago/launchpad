"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isFreshReply, newestSweepId, type FeedCard } from "@/lib/network/stack";
import { copyAndOpenReply } from "@/lib/x/intent";
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

// Reload writes replies for posts that have none; Re-Write throws out
// what is there and writes the lot again.
type ReloadMode = "reload" | "rewrite";

// What one Reload did, as the route reports it.
type ReloadSummary = {
  considered: number;
  written: number;
  reused: number;
  failed: number;
  onTerritory: number;
  declined: number;
  budgetReached: boolean;
};

// Reload and Re-Write are the only things on this page that can take a
// minute, so they say what they did rather than spinning silently.
function describeReload(summary: ReloadSummary, mode: ReloadMode): string {
  if (summary.considered === 0) {
    return mode === "rewrite"
      ? "Nothing in your Feed to rewrite yet."
      : "Nothing new from your accounts in the last day — the Feed is up to date.";
  }

  const parts: string[] = [];
  if (summary.written > 0) {
    const noun = summary.written === 1 ? "reply" : "replies";
    parts.push(
      mode === "rewrite"
        ? `${summary.written} ${noun} rewritten`
        : `${summary.written} ${noun} written`,
    );
  }
  if (summary.reused > 0) parts.push(`${summary.reused} already had one`);
  if (summary.declined > 0) {
    parts.push(`${summary.declined} left for you to read`);
  }
  if (summary.failed > 0) parts.push(`${summary.failed} couldn't be written`);
  // Says the quiet part: almost everything was written as a person
  // talking, and only these few had your own field in hand.
  if (summary.written > 0) {
    parts.push(
      summary.onTerritory > 0
        ? `${summary.onTerritory} on your field`
        : "none needed your field",
    );
  }
  if (parts.length === 0) return "Pulled the newest posts. Nothing needed a new reply.";

  const tail = summary.budgetReached
    ? mode === "rewrite"
      ? " Re-Write again for the rest."
      : " Reload again for the rest."
    : "";
  return `${parts.join(", ")}.${tail}`;
}

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
  const [busy, setBusy] = useState<ReloadMode | null>(null);
  const [reloadNote, setReloadNote] = useState<string | null>(null);
  // The card whose written reply was last handed to X, so the button can
  // say so — the same acknowledgement the quick-comment sheet gives.
  const [sentSuggestion, setSentSuggestion] = useState<string | null>(null);
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
    if (refreshing || busy) return;
    setRefreshing(true);
    setError(null);
    refresh(true);
  }

  // Both buttons, one request. Reload polls every watched account for its
  // newest posts and writes a reply for each; Re-Write skips the poll and
  // rewrites the replies already in the Feed. The polling and the writing
  // both happen server-side, which is why this waits rather than
  // streaming, and why the button says how long it is going to be.
  async function runReload(mode: ReloadMode) {
    if (busy || refreshing) return;
    setBusy(mode);
    setError(null);
    setReloadNote(null);

    try {
      const response = await fetch("/api/feed/reload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewrite: mode === "rewrite" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const label = mode === "rewrite" ? "Re-Write" : "Reload";
        throw new Error(body?.error ?? `${label} failed (${response.status}).`);
      }

      setFeed((body?.feed ?? []) as FeedCard[]);
      setCardStates({});
      setSentSuggestion(null);
      if (body?.summary) {
        setReloadNote(describeReload(body.summary as ReloadSummary, mode));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "rewrite"
            ? "Failed to rewrite your replies."
            : "Failed to reload your Feed.",
      );
    } finally {
      setBusy(null);
    }
  }

  // Pull to refresh, done with the page's own scroll position: the drag
  // only counts when the stream is already at the top, so it never fights
  // an ordinary scroll.
  function onTouchStart(event: React.TouchEvent) {
    pullStart.current = window.scrollY <= 0 ? event.touches[0].clientY : null;
  }

  function onTouchMove(event: React.TouchEvent) {
    if (pullStart.current === null || refreshing || busy) return;
    const distance = event.touches[0].clientY - pullStart.current;
    setPull(distance > 0 ? Math.min(distance, PULL_THRESHOLD + 20) : 0);
  }

  function onTouchEnd() {
    if (pull >= PULL_THRESHOLD && !refreshing && !busy) {
      setRefreshing(true);
      setError(null);
      refresh(true);
    }
    pullStart.current = null;
    setPull(0);
  }

  // Straight from the card: copy the written reply and open X's composer
  // on that post. No queue row, no second call — the reply already exists,
  // and this is the whole point of having written it up front.
  function sendSuggested(card: FeedCard) {
    if (!card.suggested_reply) return;
    copyAndOpenReply(card.x_tweet_id, card.suggested_reply);
    setSentSuggestion(card.id);
  }

  function setCardState(cardId: string, state: CardState) {
    setCardStates((prev) => ({ ...prev, [cardId]: state }));
  }

  // Done: dealt with, and gone for good. The row stays in the table with
  // its state flipped rather than being deleted — that flipped state is
  // exactly what stops the next poll from putting the post back on top.
  //
  // The endpoint is still /api/network/skip and the state is still
  // "skipped", because they always meant this. Only the button lied: it
  // said "Skip", which reads as "not now", when the row it writes has
  // never come back.
  async function handleDone(card: FeedCard) {
    setCardState(card.id, "gone");
    const response = await fetch("/api/network/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card_id: card.id }),
    }).catch(() => null);

    if (!response || !response.ok) {
      setCardState(card.id, "live");
      setError("Couldn't mark that done. It's still in your Feed.");
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
      // A reply Reload already wrote for this post opens with the sheet,
      // so the sheet is never emptier than the card behind it.
      suggestion: card.suggested_reply,
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
  // The same sweep the server sorted on, so a card's label can never
  // disagree with the band it was put in.
  const currentSweep = newestSweepId(visible);

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
            New posts from every account you watch, last 24 hours. Reply, like,
            or mark done.
          </p>
        </div>
        {/* A clean sweep, on demand: throw out every reply in the Feed
            and write them all again. Smaller than Refresh and sitting to
            its left, because it is the rarer of the two — you press it
            when you have read the replies and want a different set, not
            on the way in. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void runReload("rewrite")}
            disabled={Boolean(busy) || refreshing || visible.length === 0}
            title="Write a fresh reply for every post in your Feed"
            className="min-h-11 shrink-0 rounded-full border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {busy === "rewrite" ? "Re-writing…" : "Re-Write"}
          </button>
          <button
            type="button"
            onClick={handleRefreshClick}
            disabled={refreshing || Boolean(busy)}
            className="min-h-11 shrink-0 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* The one button this page is for: the newest posts from everyone
          you watch, each with a reply already written for it. Full width
          and thumb-height because on a phone it is the first thing you
          press and often the only one. */}
      <button
        type="button"
        onClick={() => void runReload("reload")}
        disabled={Boolean(busy) || refreshing || !hasProfiles}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy ? (
          <>
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            {busy === "rewrite"
              ? "Rewriting every reply…"
              : "Reading posts, writing replies…"}
          </>
        ) : (
          <>
            <span aria-hidden>↻</span>
            Reload
          </>
        )}
      </button>

      <p className="-mt-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
        {busy === "rewrite"
          ? "Writing a fresh reply for every post already in your Feed. This takes a moment."
          : busy
            ? "Pulling the newest posts from every account you watch. This takes a moment."
            : "Pulls the last day of posts from every account you watch and writes a reply for each one."}
      </p>

      {reloadNote ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {reloadNote}
        </p>
      ) : null}

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
            {hasProfiles ? "Nothing new to reply to." : "No accounts to watch yet."}
          </p>
          <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
            {hasProfiles
              ? "Nobody you watch has posted anything new in the last day. Try Explore for strangers worth replying to."
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

                {/* Read and declined: the model could not follow this
                    post, and said so instead of replying anyway. Worth
                    its own block — a card with no reply because nobody
                    has swept it yet is a different thing. */}
                {!card.suggested_reply && card.reply_unclear ? (
                  <div className="flex flex-col gap-1 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    <span className="text-[10px] font-medium tracking-wider text-amber-700 uppercase dark:text-amber-300">
                      One for you to read
                    </span>
                    <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-100">
                      {card.reply_unclear}
                    </p>
                  </div>
                ) : null}

                {card.suggested_reply ? (
                  <div
                    className={`flex flex-col gap-2 rounded-xl border p-3 ${
                      isFreshReply(card, currentSweep)
                        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
                        : // Carried over from an earlier sweep. Still a
                          // usable reply, so it keeps its block — just
                          // drained of the colour that means "new".
                          "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-medium tracking-wider uppercase ${
                        isFreshReply(card, currentSweep)
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {isFreshReply(card, currentSweep)
                        ? "Written for this post"
                        : `Old · written ${formatAge(card.suggested_reply_at)} ago`}
                    </span>
                    <p
                      className={`text-sm leading-relaxed whitespace-pre-wrap ${
                        isFreshReply(card, currentSweep)
                          ? "text-emerald-900 dark:text-emerald-100"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {card.suggested_reply}
                    </p>
                    <button
                      type="button"
                      onClick={() => sendSuggested(card)}
                      className={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors ${
                        isFreshReply(card, currentSweep)
                          ? "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                          : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {sentSuggestion === card.id
                        ? "Copied — finish in X ↗"
                        : "Copy & open X ↗"}
                    </button>
                  </div>
                ) : null}

                {/* What it thought the post was about. The reply is
                    only as good as this, so it is on the card rather than
                    in a log — a wrong reading is visible here in a second,
                    and invisible anywhere else. */}
                {card.reply_about ? (
                  <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                    <span className="font-medium">Read as:</span> {card.reply_about}
                  </p>
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
                    {card.suggested_reply ? "More replies" : "Reply"}
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
                    onClick={() => void handleDone(card)}
                    title="Clear this from your Feed for good"
                    className="min-h-11 rounded-full border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Done
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
