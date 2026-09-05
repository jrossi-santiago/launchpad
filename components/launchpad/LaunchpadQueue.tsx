"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { RegenerationUsage } from "@/lib/usage/regenerations";
import type { AllActionUsage } from "@/lib/usage/actions";
import { TweetCard, type PostableDraft } from "@/components/launchpad/TweetCard";
import { UsageMeter } from "@/components/launchpad/UsageMeter";
import { ActionUsageMeter } from "@/components/launchpad/ActionUsageMeter";

export type QueueItem = {
  tweet: TweetRow;
  drafts: PostableDraft[];
  alreadyLiked: boolean;
  alreadyFollowedAuthor: boolean;
};

export function LaunchpadQueue({
  initialItems,
  initialUsage,
  xHandle,
  canAutoReply,
  initialActionUsage,
}: {
  initialItems: QueueItem[];
  initialUsage: RegenerationUsage;
  xHandle: string | null;
  canAutoReply: boolean;
  initialActionUsage: AllActionUsage;
}) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [usage, setUsage] = useState<RegenerationUsage>(initialUsage);
  const [actionUsage, setActionUsage] = useState<AllActionUsage>(initialActionUsage);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Record<string, string>>({});
  const [postingIds, setPostingIds] = useState<Set<string>>(new Set());
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});
  const [markingPostedIds, setMarkingPostedIds] = useState<Set<string>>(new Set());
  const [markPostedErrors, setMarkPostedErrors] = useState<Record<string, string>>({});
  const [likingIds, setLikingIds] = useState<Set<string>>(new Set());
  const [likeErrors, setLikeErrors] = useState<Record<string, string>>({});
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followErrors, setFollowErrors] = useState<Record<string, string>>({});
  const [pullingAudienceIds, setPullingAudienceIds] = useState<Set<string>>(new Set());
  const [audienceProgress, setAudienceProgress] = useState<Record<string, string>>({});
  const [audienceResults, setAudienceResults] = useState<Record<string, string>>({});
  const [audienceErrors, setAudienceErrors] = useState<Record<string, string>>({});

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

      const { tweet, drafts } = body as { tweet: TweetRow; drafts: PostableDraft[] };

      setItems((prev) => [
        { tweet, drafts, alreadyLiked: false, alreadyFollowedAuthor: false },
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

  function toggleExpanded(tweetId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tweetId)) next.delete(tweetId);
      else next.add(tweetId);
      return next;
    });
  }

  async function handleRegenerate(tweetId: string) {
    if (regeneratingIds.has(tweetId)) return;

    setRegeneratingIds((prev) => new Set(prev).add(tweetId));
    setRegenerateErrors((prev) => {
      const next = { ...prev };
      delete next[tweetId];
      return next;
    });

    try {
      const response = await fetch("/api/drafts/regenerate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet_id: tweetId }),
      });

      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        if (body?.usage) setUsage(body.usage as RegenerationUsage);
        setRegenerateErrors((prev) => ({
          ...prev,
          [tweetId]: body?.error ?? "You've hit today's regeneration limit.",
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error ?? `Regenerate failed (${response.status}).`);
      }

      const { drafts, usage: nextUsage } = body as {
        drafts: PostableDraft[];
        usage: RegenerationUsage;
      };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.id === tweetId ? { ...item, drafts } : item,
        ),
      );
      setUsage(nextUsage);
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [tweetId]:
          err instanceof Error ? err.message : "Failed to regenerate drafts.",
      }));
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  // `withCta` is the card's toggle, not a property of the draft: the CTA
  // is stored on its own and only becomes part of the reply if the founder
  // says so for this post. The server does the joining, so what goes out
  // and what is recorded as posted_text are the same string.
  async function handlePost(draftId: string, withCta: boolean) {
    if (postingIds.has(draftId)) return;

    setPostingIds((prev) => new Set(prev).add(draftId));
    setPostErrors((prev) => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });

    try {
      const response = await fetch("/api/drafts/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft_id: draftId, with_cta: withCta }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Post failed (${response.status}).`);
      }

      const { draft: updatedDraft } = body as { draft: PostableDraft };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.id === updatedDraft.tweet_id
            ? {
                ...item,
                tweet: { ...item.tweet, status: "actioned" },
                drafts: item.drafts.map((d) =>
                  d.id === updatedDraft.id ? updatedDraft : d,
                ),
              }
            : item,
        ),
      );
    } catch (err) {
      setPostErrors((prev) => ({
        ...prev,
        [draftId]: err instanceof Error ? err.message : "Failed to post that reply.",
      }));
    } finally {
      setPostingIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
    }
  }

  async function handleMarkPosted(draftId: string) {
    if (markingPostedIds.has(draftId)) return;

    setMarkingPostedIds((prev) => new Set(prev).add(draftId));
    setMarkPostedErrors((prev) => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });

    try {
      const response = await fetch("/api/drafts/mark-posted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft_id: draftId }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Mark posted failed (${response.status}).`);
      }

      const { draft: updatedDraft } = body as { draft: PostableDraft };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.id === updatedDraft.tweet_id
            ? {
                ...item,
                tweet: { ...item.tweet, status: "actioned" },
                drafts: item.drafts.map((d) =>
                  d.id === updatedDraft.id ? updatedDraft : d,
                ),
              }
            : item,
        ),
      );
    } catch (err) {
      setMarkPostedErrors((prev) => ({
        ...prev,
        [draftId]:
          err instanceof Error ? err.message : "Failed to mark that draft as posted.",
      }));
    } finally {
      setMarkingPostedIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
    }
  }

  async function handleLike(tweetId: string) {
    if (likingIds.has(tweetId)) return;

    setLikingIds((prev) => new Set(prev).add(tweetId));
    setLikeErrors((prev) => {
      const next = { ...prev };
      delete next[tweetId];
      return next;
    });

    try {
      const response = await fetch("/api/tweets/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet_id: tweetId }),
      });

      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        if (body?.usage) setActionUsage((prev) => ({ ...prev, like: body.usage }));
        setLikeErrors((prev) => ({
          ...prev,
          [tweetId]: body?.error ?? "You've hit today's like limit.",
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error ?? `Like failed (${response.status}).`);
      }

      const { usage: nextLikeUsage } = body as { usage: AllActionUsage["like"] };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.id === tweetId ? { ...item, alreadyLiked: true } : item,
        ),
      );
      setActionUsage((prev) => ({ ...prev, like: nextLikeUsage }));
    } catch (err) {
      setLikeErrors((prev) => ({
        ...prev,
        [tweetId]: err instanceof Error ? err.message : "Failed to like that tweet.",
      }));
    } finally {
      setLikingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  async function handleFollow(tweetId: string) {
    if (followingIds.has(tweetId)) return;

    setFollowingIds((prev) => new Set(prev).add(tweetId));
    setFollowErrors((prev) => {
      const next = { ...prev };
      delete next[tweetId];
      return next;
    });

    try {
      const response = await fetch("/api/tweets/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet_id: tweetId }),
      });

      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        if (body?.usage) setActionUsage((prev) => ({ ...prev, follow: body.usage }));
        setFollowErrors((prev) => ({
          ...prev,
          [tweetId]: body?.error ?? "You've hit today's follow limit.",
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(body?.error ?? `Follow failed (${response.status}).`);
      }

      const { authorHandle, usage: nextFollowUsage } = body as {
        authorHandle: string;
        usage: AllActionUsage["follow"];
      };

      setItems((prev) =>
        prev.map((item) =>
          item.tweet.author_handle === authorHandle
            ? { ...item, alreadyFollowedAuthor: true }
            : item,
        ),
      );
      setActionUsage((prev) => ({ ...prev, follow: nextFollowUsage }));
    } catch (err) {
      setFollowErrors((prev) => ({
        ...prev,
        [tweetId]: err instanceof Error ? err.message : "Failed to follow that author.",
      }));
    } finally {
      setFollowingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  async function handlePullAudience(tweetId: string) {
    if (pullingAudienceIds.has(tweetId)) return;

    setPullingAudienceIds((prev) => new Set(prev).add(tweetId));
    setAudienceErrors((prev) => {
      const next = { ...prev };
      delete next[tweetId];
      return next;
    });

    let peopleFound = 0;
    let newLeadsAdded = 0;
    const sourceLabels: Record<"replied" | "retweeted", string> = {
      replied: "repliers",
      retweeted: "retweeters",
    };

    try {
      for (const sourceType of ["replied", "retweeted"] as const) {
        let cursor: string | null = null;

        for (let pageNum = 1; pageNum <= 5; pageNum += 1) {
          setAudienceProgress((prev) => ({
            ...prev,
            [tweetId]: `Pulling ${sourceLabels[sourceType]}… page ${pageNum} of 5`,
          }));

          const response = await fetch("/api/tweets/pull-audience", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tweet_id: tweetId, source_type: sourceType, cursor }),
          });

          const body = await response.json().catch(() => null);

          if (!response.ok) {
            throw new Error(body?.error ?? `Pull audience failed (${response.status}).`);
          }

          const { leads, peopleFound: pageFound, nextCursor, hasMore } = body as {
            leads: unknown[];
            peopleFound: number;
            nextCursor: string | null;
            hasMore: boolean;
          };

          peopleFound += pageFound;
          newLeadsAdded += leads.length;

          cursor = nextCursor;
          if (!hasMore || pageNum === 5) break;
        }
      }

      setAudienceResults((prev) => ({
        ...prev,
        [tweetId]: `${peopleFound} people found · ${newLeadsAdded} new leads added`,
      }));
    } catch (err) {
      setAudienceErrors((prev) => ({
        ...prev,
        [tweetId]: err instanceof Error ? err.message : "Failed to pull that tweet's audience.",
      }));
    } finally {
      setAudienceProgress((prev) => {
        const next = { ...prev };
        delete next[tweetId];
        return next;
      });
      setPullingAudienceIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    }
  }

  async function handleDelete(tweetId: string) {
    if (deletingIds.has(tweetId)) return;

    setDeletingIds((prev) => new Set(prev).add(tweetId));

    try {
      const response = await fetch(`/api/tweets/${tweetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${response.status}).`);
      }

      setItems((prev) => prev.filter((item) => item.tweet.id !== tweetId));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
    } catch (err) {
      setRegenerateErrors((prev) => ({
        ...prev,
        [tweetId]:
          err instanceof Error ? err.message : "Failed to delete that tweet.",
      }));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(tweetId);
        return next;
      });
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            No tweets in your queue yet.
          </p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Paste a tweet URL or ID above to add one, or pull high-engagement
            posts in from Radar —{" "}
            <span className="font-medium">coming soon</span>.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <UsageMeter usage={usage} />
            <ActionUsageMeter usage={actionUsage} />
          </div>

          {/* Explained once here rather than on every draft: without it,
              the missing Post button reads as something broken. */}
          {xHandle != null && !canAutoReply ? (
            <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                Replies are sent by you, not by HeatCheck.
              </span>{" "}
              Since 23 February 2026 X does not allow apps to reply to other
              people&apos;s posts. Hit{" "}
              <span className="font-medium">Copy &amp; Post</span> — it copies
              the draft and opens X&apos;s reply box in a new tab with the text
              already in it, so you just press Post. Then{" "}
              <span className="font-medium">Mark posted</span> back here to keep
              your queue straight. Likes and follows still happen with one
              click.
            </div>
          ) : null}
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <div key={item.tweet.id} className="flex flex-col gap-2">
                <TweetCard
                  tweet={item.tweet}
                  drafts={item.drafts}
                  expanded={expandedIds.has(item.tweet.id)}
                  onToggle={() => toggleExpanded(item.tweet.id)}
                  onRegenerate={() => void handleRegenerate(item.tweet.id)}
                  isRegenerating={regeneratingIds.has(item.tweet.id)}
                  canRegenerate={usage.remaining > 0}
                  onDelete={() => void handleDelete(item.tweet.id)}
                  isDeleting={deletingIds.has(item.tweet.id)}
                  xHandle={xHandle}
                  canAutoReply={canAutoReply}
                  onPost={(draftId, withCta) => void handlePost(draftId, withCta)}
                  postingIds={postingIds}
                  postErrors={postErrors}
                  onMarkPosted={(draftId) => void handleMarkPosted(draftId)}
                  markingPostedIds={markingPostedIds}
                  markPostedErrors={markPostedErrors}
                  alreadyLiked={item.alreadyLiked}
                  alreadyFollowedAuthor={item.alreadyFollowedAuthor}
                  onLike={() => void handleLike(item.tweet.id)}
                  onFollow={() => void handleFollow(item.tweet.id)}
                  isLiking={likingIds.has(item.tweet.id)}
                  isFollowing={followingIds.has(item.tweet.id)}
                  canLike={actionUsage.like.remaining > 0}
                  canFollow={actionUsage.follow.remaining > 0}
                  likeError={likeErrors[item.tweet.id]}
                  followError={followErrors[item.tweet.id]}
                  onPullAudience={() => void handlePullAudience(item.tweet.id)}
                  isPullingAudience={pullingAudienceIds.has(item.tweet.id)}
                  audienceProgress={audienceProgress[item.tweet.id] || undefined}
                  audienceResult={audienceResults[item.tweet.id]}
                  audienceError={audienceErrors[item.tweet.id]}
                />
                {regenerateErrors[item.tweet.id] ? (
                  <p className="px-2 text-sm text-red-600 dark:text-red-400">
                    {regenerateErrors[item.tweet.id]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
