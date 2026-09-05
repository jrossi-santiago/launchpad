"use client";

import { useMemo, useState } from "react";
import {
  POST_MAX,
  type PostUsage,
  type ScheduledPostRow,
  type ScheduledPostStatus,
} from "@/lib/scheduler/posts";
import {
  easternInputToUtc,
  formatEastern,
  formatUtc,
  utcToEasternInput,
} from "@/lib/time/eastern";

const STATUS_LABEL: Record<ScheduledPostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  claimed: "Sending…",
  posted: "Posted",
  failed: "Failed",
  canceled: "Canceled",
};

const STATUS_CLASS: Record<ScheduledPostStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  scheduled: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  claimed: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  posted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  canceled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

type Sharpened = { text: string; changed: string };

export function SchedulerTab({
  initialPosts,
  initialUsage,
  canPost,
  handle,
}: {
  initialPosts: ScheduledPostRow[];
  initialUsage: PostUsage;
  canPost: boolean;
  handle: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [usage, setUsage] = useState(initialUsage);
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sharpened, setSharpened] = useState<Sharpened | null>(null);
  const [busy, setBusy] = useState<null | "save" | "sharpen" | "now">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const remaining = POST_MAX - body.trim().length;

  // The converter the whole tab exists around: the founder types Eastern,
  // the app stores UTC, and the UTC it will store is on screen while they
  // type rather than discovered afterwards.
  const utcPreview = useMemo(() => {
    if (!when) return null;
    const instant = easternInputToUtc(when);
    if (!instant) return null;
    return `${formatEastern(instant.toISOString())} — stored as ${formatUtc(instant.toISOString())}`;
  }, [when]);

  function resetComposer() {
    setBody("");
    setWhen("");
    setEditingId(null);
    setSharpened(null);
  }

  // Every row the server hands back replaces its own copy in the list, so
  // there is never a second source of truth for a post's status.
  function mergePost(row: ScheduledPostRow) {
    setPosts((current) => {
      const without = current.filter((post) => post.id !== row.id);
      return [row, ...without].sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
  }

  async function call(path: string, payload: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Something went wrong.",
      );
    }

    return data;
  }

  async function save(schedule: boolean) {
    if (busy || !body.trim()) return;

    setBusy("save");
    setError(null);
    setNotice(null);

    try {
      let scheduledAt: string | undefined;

      if (schedule) {
        const instant = easternInputToUtc(when);
        if (!instant) {
          setError("Pick a date and time first.");
          setBusy(null);
          return;
        }
        scheduledAt = instant.toISOString();
      }

      const data = await call("/api/scheduler/save", {
        id: editingId,
        body,
        scheduled_at: scheduledAt,
        source: sharpened?.text === body.trim() ? "sharpened" : "composer",
      });

      mergePost(data.post as ScheduledPostRow);
      setNotice(
        schedule
          ? `Scheduled for ${formatEastern((data.post as ScheduledPostRow).scheduled_at!)}.`
          : "Saved as a draft.",
      );
      resetComposer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that post.");
    } finally {
      setBusy(null);
    }
  }

  async function sharpen() {
    if (busy || !body.trim()) return;

    setBusy("sharpen");
    setError(null);

    try {
      const data = (await call("/api/scheduler/sharpen", { body })) as Sharpened;
      setSharpened(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sharpen that post.");
    } finally {
      setBusy(null);
    }
  }

  async function postNow() {
    if (busy || !body.trim()) return;

    setBusy("now");
    setError(null);
    setNotice(null);

    try {
      const data = await call("/api/scheduler/post-now", { id: editingId, body });
      setUsage(data.usage as PostUsage);
      setNotice(`Posted. ${data.permalink}`);
      resetComposer();
      // The row changed status server-side; a reload is the honest way to
      // pick that up without inventing a second copy of it here.
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send that post.");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    try {
      const data = await call("/api/scheduler/cancel", { id });
      setPosts((current) => current.filter((post) => post.id !== id));
      void data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel that post.");
    }
  }

  function edit(post: ScheduledPostRow) {
    setEditingId(post.id);
    setBody(post.body);
    setWhen(post.scheduled_at ? utcToEasternInput(post.scheduled_at) : "");
    setSharpened(null);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Scheduler
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your own posts. Comments get you seen; these are where the attention
          lands. {usage.remaining} of {usage.limit} sends left today.
        </p>
      </header>

      {!canPost && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Scheduled posts need an officially connected X account. Connect X
          under <span className="font-medium">You → Settings</span> — the older
          cookie connection can reply, but it cannot post on its own.
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          placeholder={`What are you posting${handle ? ` as @${handle.replace(/^@/, "")}` : ""}?`}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-transparent p-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:text-zinc-100"
        />

        <div className="mt-2 flex items-center justify-between text-xs">
          <span
            className={
              remaining < 0
                ? "font-medium text-red-600 dark:text-red-400"
                : "text-zinc-400"
            }
          >
            {remaining} left
          </span>
          <button
            type="button"
            onClick={sharpen}
            disabled={busy !== null || !body.trim()}
            className="rounded-full border border-zinc-200 px-3 py-1 font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            {busy === "sharpen" ? "Sharpening…" : "Sharpen"}
          </button>
        </div>

        {sharpened && (
          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            <p className="text-sm text-zinc-900 dark:text-zinc-100">
              {sharpened.text}
            </p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {sharpened.changed}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setBody(sharpened.text);
                  setSharpened(null);
                }}
                className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Use this
              </button>
              <button
                type="button"
                onClick={() => setSharpened(null)}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Keep mine
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            Send at (Eastern)
            <input
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
            />
          </label>

          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={busy !== null || !body.trim()}
              className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy !== null || !body.trim() || !when}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "save" ? "Saving…" : "Schedule"}
            </button>
            <button
              type="button"
              onClick={postNow}
              disabled={busy !== null || !body.trim() || usage.remaining <= 0 || !canPost}
              className="rounded-full border border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40 dark:border-zinc-100 dark:text-zinc-100"
            >
              {busy === "now" ? "Posting…" : "Post now"}
            </button>
          </div>
        </div>

        {utcPreview && (
          <p className="mt-2 text-xs text-zinc-400">Goes out {utcPreview}</p>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {notice && !error && (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
            {notice}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {posts.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Nothing lined up yet.
          </p>
        )}

        {posts.map((post) => {
          const status = post.status as ScheduledPostStatus;

          return (
            <article
              key={post.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
                >
                  {STATUS_LABEL[status]}
                </span>
                {post.scheduled_at && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatEastern(post.scheduled_at)}
                    <span className="text-zinc-400"> · {formatUtc(post.scheduled_at)}</span>
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
                {post.body}
              </p>

              {post.last_error && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {post.last_error}
                </p>
              )}

              <div className="mt-3 flex gap-3 text-xs">
                {post.posted_x_tweet_id && (
                  <a
                    href={`https://x.com/i/status/${post.posted_x_tweet_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-zinc-700 underline dark:text-zinc-200"
                  >
                    View on X
                  </a>
                )}
                {status !== "posted" && status !== "claimed" && (
                  <>
                    <button
                      type="button"
                      onClick={() => edit(post)}
                      className="font-medium text-zinc-700 dark:text-zinc-200"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => cancel(post.id)}
                      className="font-medium text-zinc-500 dark:text-zinc-400"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
