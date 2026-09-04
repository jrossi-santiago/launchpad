"use client";

import type { NetworkCard as Card } from "@/lib/network/stack";

export type SendState = "idle" | "sending" | "drafting" | "ready" | "failed";

const SEND_LABELS: Record<Exclude<SendState, "idle" | "sending">, string> = {
  drafting: "Sent — drafting replies…",
  ready: "Sent — 3 drafts ready in Launchpad",
  failed: "Sent — draft failed, retry from Launchpad",
};

// "2h", "3d", "just now" — deliberately terse, because it sits in the card
// header next to the handle.
export function formatAge(postedAt: string | null): string {
  if (!postedAt) return "";
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return "";

  const minutes = Math.floor((Date.now() - posted) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NetworkCard({
  card,
  handle,
  position,
  total,
  onSend,
  onSkip,
  sendState,
}: {
  card: Card;
  handle: string;
  position: number;
  total: number;
  onSend: () => void;
  onSkip: () => void;
  sendState: SendState;
}) {
  const busy = sendState === "sending";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          @{handle}
        </span>
        <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
          {formatAge(card.posted_at)}
          {total > 1 ? ` · ${position + 1}/${total}` : ""}
        </span>
      </div>

      <p className="min-h-24 text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
        {card.content ?? ""}
      </p>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>{card.metrics.like_count} likes</span>
        <span>{card.metrics.retweet_count} retweets</span>
        <span>{card.metrics.reply_count} replies</span>
        {card.source === "monitor" ? (
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            live
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="flex-1 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? "Sending…" : "Send to Launchpad"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Skip
        </button>
        {card.url ? (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 px-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            X ↗
          </a>
        ) : null}
      </div>

      {sendState !== "idle" && sendState !== "sending" ? (
        <p
          className={`text-[11px] ${
            sendState === "failed"
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {SEND_LABELS[sendState]}
        </p>
      ) : null}
    </div>
  );
}
