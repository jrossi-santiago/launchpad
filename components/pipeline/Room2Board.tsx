"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PipelineCard } from "@/lib/pipeline/board";
import {
  FOUR_SHAPE_NOTE,
  MAX_COMMENTS_WHILE_LIVE,
} from "@/lib/pipeline/rules";
import {
  ACTION_CLASSES,
  STATUS_LABELS,
  daysAgo,
  postJson,
} from "@/components/pipeline/shared";

// One of the lead's recent posts, when their handle is also in Network.
// Otherwise the user pastes the URL of the post they commented on, same
// as the Queue's paste-a-link path.
export type RecentPost = {
  id: string;
  content: string | null;
  url: string | null;
  posted_at: string | null;
};

export type Room2Card = PipelineCard & { recentPosts: RecentPost[] };

// Room 2 is the Commenter, pointed at people instead of posts. Same loop:
// read what they wrote, comment, say you posted it. The difference is
// that here the app is counting, and will eventually tell you to stop.
export function Room2Board({ cards }: { cards: Room2Card[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(cards[0]?.lead.id ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = busyId !== null || pending;

  async function run(id: string, work: () => Promise<void>) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await work();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nobody live yet.
        </p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Move people out of your waitlist and they show up here to work.
        </p>
        <a
          href="/you/pipeline"
          className="mt-2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Open Pipeline
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {cards.map((card) => (
        <LeadPanel
          key={card.lead.id}
          card={card}
          open={openId === card.lead.id}
          busy={busy}
          onToggle={() =>
            setOpenId((prev) => (prev === card.lead.id ? null : card.lead.id))
          }
          onLogComment={(ourUrl, theirUrl) =>
            run(card.lead.id, async () => {
              await postJson("/api/pipeline/comment", {
                lead_id: card.lead.id,
                our_comment_url: ourUrl || null,
                their_post_url: theirUrl || null,
              });
            })
          }
          onSignal={(signal, eventId, substantive) =>
            run(card.lead.id, async () => {
              await postJson("/api/pipeline/reply", {
                lead_id: card.lead.id,
                signal,
                event_id: eventId ?? null,
                substantive: substantive ?? false,
              });
            })
          }
          onPitched={() =>
            run(card.lead.id, async () => {
              await postJson("/api/pipeline/status", {
                lead_id: card.lead.id,
                action: "pitched",
              });
            })
          }
          onConverted={() =>
            run(card.lead.id, async () => {
              await postJson("/api/pipeline/status", {
                lead_id: card.lead.id,
                action: "converted",
              });
            })
          }
        />
      ))}
    </div>
  );
}

function LeadPanel({
  card,
  open,
  busy,
  onToggle,
  onLogComment,
  onSignal,
  onPitched,
  onConverted,
}: {
  card: Room2Card;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onLogComment: (ourUrl: string, theirUrl: string) => void;
  onSignal: (
    signal: "like" | "reply",
    eventId?: string | null,
    substantive?: boolean,
  ) => void;
  onPitched: () => void;
  onConverted: () => void;
}) {
  const { lead, nextAction } = card;
  const [ourUrl, setOurUrl] = useState("");
  const [theirUrl, setTheirUrl] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [copied, setCopied] = useState(false);

  // The gate the whole feature turns on: no pitch help until they have
  // actually said something back.
  const theyTalked = lead.their_reply_count >= 1;

  async function copyNote() {
    try {
      await navigator.clipboard.writeText(FOUR_SHAPE_NOTE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in this context — the text is on screen.
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            @{lead.handle}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {lead.our_comment_count}/{MAX_COMMENTS_WHILE_LIVE} comments ·{" "}
            {daysAgo(lead.moved_to_live_at)} live · {STATUS_LABELS[lead.status]}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ACTION_CLASSES[nextAction.kind]}`}
          >
            {nextAction.label}
          </span>
          <span aria-hidden className="text-zinc-400">
            {open ? "▾" : "›"}
          </span>
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {nextAction.detail}
          </p>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Their recent posts
            </h3>
            {card.recentPosts.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {card.recentPosts.map((post) => (
                  <li
                    key={post.id}
                    className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                  >
                    <p className="whitespace-pre-wrap">{post.content}</p>
                    {post.url ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setTheirUrl(post.url ?? "")}
                        className="mt-2 inline-block text-xs text-zinc-500 underline decoration-dotted underline-offset-2 dark:text-zinc-400"
                      >
                        Open on X
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                @{lead.handle} isn&apos;t one of your watched accounts, so their
                posts aren&apos;t pulled in.{" "}
                <a
                  href={`https://x.com/${lead.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2"
                >
                  Open their profile
                </a>{" "}
                and paste the post URL below.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Log comment
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              You post the comment on X yourself. This just records that it
              went up, so the count and the timing are real.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Their post URL
                <input
                  value={theirUrl}
                  onChange={(e) => setTheirUrl(e.target.value)}
                  placeholder="https://x.com/…"
                  className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Your comment URL (optional)
                <input
                  value={ourUrl}
                  onChange={(e) => setOurUrl(e.target.value)}
                  placeholder="https://x.com/…"
                  className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  onLogComment(ourUrl, theirUrl);
                  setOurUrl("");
                  setTheirUrl("");
                }}
                disabled={busy}
                className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
              >
                That went up
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Did they react?
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onSignal("like")}
                disabled={busy}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                They liked it
              </button>
              <button
                type="button"
                onClick={() => onSignal("reply", card.events[0]?.id ?? null)}
                disabled={busy}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                They replied
              </button>
              <button
                type="button"
                onClick={() => onSignal("reply", card.events[0]?.id ?? null, true)}
                disabled={busy}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                They replied — real conversation
              </button>
            </div>

            {card.events.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-[11px] text-zinc-400">
                {card.events.slice(0, 5).map((event) => (
                  <li key={event.id}>
                    Commented {daysAgo(event.at)} ago
                    {event.they_replied ? " · they replied" : ""}
                    {event.their_post_url ? (
                      <>
                        {" · "}
                        <a
                          href={event.their_post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted underline-offset-2"
                        >
                          post
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {theyTalked ? (
            <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                They talked
              </h3>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                I use a 4-shape note for comments like that. Want it?
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowNote((v) => !v)}
                  className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900"
                >
                  {showNote ? "Hide it" : "Show me"}
                </button>
                {lead.status !== "pitched" ? (
                  <button
                    type="button"
                    onClick={onPitched}
                    disabled={busy}
                    className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40 dark:bg-emerald-400 dark:text-emerald-950"
                  >
                    I sent the pitch
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onConverted}
                    disabled={busy}
                    className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40 dark:bg-emerald-400 dark:text-emerald-950"
                  >
                    They bought
                  </button>
                )}
              </div>

              {showNote ? (
                <div className="mt-2">
                  <pre className="whitespace-pre-wrap rounded-lg border border-emerald-200 bg-white p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                    {FOUR_SHAPE_NOTE}
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copyNote()}
                    className="mt-2 rounded-full border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                    You send this yourself — nothing here messages anyone.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
