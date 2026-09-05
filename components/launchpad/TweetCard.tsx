"use client";

import { useState } from "react";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";
import { copyAndOpenReply, withCta } from "@/lib/x/intent";
import { TypeChip } from "@/components/comment/TypeChip";
import { CtaToggle } from "@/components/comment/CtaToggle";

// Mirrors GROK_VARIANT in lib/anthropic/drafts.ts. Kept local so this client
// component does not pull the server-side drafts module into the browser bundle.
const GROK_VARIANT = 3;

const STATUS_LABELS: Record<string, string> = {
  queued: "queued",
  drafted: "drafted",
  actioned: "actioned",
  dismissed: "dismissed",
};

// drafts.posted_at/posted_text/posted_x_tweet_id are plain nullable columns
// added by migration 0008 — Supabase's select("*") includes them
// automatically, but lib/anthropic/drafts.ts's DraftRow type is untouched
// today (see AGENTS.md), so this component extends it locally.
export type PostableDraft = DraftRow & {
  posted_at: string | null;
  posted_text: string | null;
  posted_x_tweet_id: string | null;
};

export function TweetCard({
  tweet,
  drafts,
  expanded,
  onToggle,
  onRegenerate,
  isRegenerating,
  canRegenerate,
  onDelete,
  isDeleting,
  xHandle,
  canAutoReply,
  onPost,
  postingIds,
  postErrors,
  onMarkPosted,
  markingPostedIds,
  markPostedErrors,
  alreadyLiked,
  alreadyFollowedAuthor,
  onLike,
  onFollow,
  isLiking,
  isFollowing,
  canLike,
  canFollow,
  likeError,
  followError,
  onPullAudience,
  isPullingAudience,
  audienceProgress,
  audienceResult,
  audienceError,
}: {
  tweet: TweetRow;
  drafts: PostableDraft[];
  expanded: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  canRegenerate: boolean;
  onDelete: () => void;
  isDeleting: boolean;
  xHandle: string | null;
  canAutoReply: boolean;
  // The boolean is the card's CTA toggle for that draft — see CtaToggle.
  onPost: (draftId: string, withCta: boolean) => void;
  postingIds: Set<string>;
  postErrors: Record<string, string>;
  onMarkPosted: (draftId: string) => void;
  markingPostedIds: Set<string>;
  markPostedErrors: Record<string, string>;
  alreadyLiked: boolean;
  alreadyFollowedAuthor: boolean;
  onLike: () => void;
  onFollow: () => void;
  isLiking: boolean;
  isFollowing: boolean;
  canLike: boolean;
  canFollow: boolean;
  likeError: string | undefined;
  followError: string | undefined;
  onPullAudience: () => void;
  isPullingAudience: boolean;
  audienceProgress: string | undefined;
  audienceResult: string | undefined;
  audienceError: string | undefined;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Drafts showing their CTA. Per draft, because the three options on a
  // card are three different comments and only one of them goes out.
  const [ctaOn, setCtaOn] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingFollow, setConfirmingFollow] = useState(false);

  function toggleCta(draftId: string) {
    setCtaOn((current) => {
      const next = new Set(current);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  }

  // The draft as the card is currently showing it: the comment, plus the
  // CTA if this draft has it turned on.
  function textOf(draft: DraftRow): string {
    return withCta(draft.draft_text ?? "", ctaOn.has(draft.id) ? draft.draft_cta : null);
  }

  function handleCopyAndPost(draft: DraftRow) {
    if (!draft.draft_text) return;

    // Copies and opens X's composer in one gesture — see lib/x/intent.ts
    // for why the copy is deliberately not awaited first.
    copyAndOpenReply(tweet.x_tweet_id, textOf(draft));

    setCopiedId(draft.id);
    setTimeout(() => {
      setCopiedId((current) => (current === draft.id ? null : current));
    }, 1500);
  }

  async function handleCopy(draft: DraftRow) {
    if (!draft.draft_text) return;
    try {
      await navigator.clipboard.writeText(textOf(draft));
      setCopiedId(draft.id);
      setTimeout(() => {
        setCopiedId((current) => (current === draft.id ? null : current));
      }, 1500);
    } catch {
      // Clipboard access denied or unavailable in this browser context.
    }
  }

  const metrics = tweet.metrics ?? {
    like_count: 0,
    retweet_count: 0,
    reply_count: 0,
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-6 py-4 text-left"
      >
        <span
          className={`shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="w-32 shrink-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {tweet.author_handle ?? "Unknown author"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
          {tweet.content ?? ""}
        </span>
        <span className="hidden shrink-0 gap-3 text-xs text-zinc-500 dark:text-zinc-400 sm:flex">
          <span>{metrics.like_count ?? 0} likes</span>
          <span>{metrics.retweet_count ?? 0} retweets</span>
          <span>{metrics.reply_count ?? 0} replies</span>
        </span>
        <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {STATUS_LABELS[tweet.status] ?? tweet.status}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-zinc-200 px-6 py-5 dark:border-zinc-800">
          {tweet.url ? (
            <a
              href={tweet.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              View on X →
            </a>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPullAudience}
              disabled={isPullingAudience}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {isPullingAudience
                ? "Pulling…"
                : audienceResult
                  ? "Pull Audience Again"
                  : "Pull Audience"}
            </button>
            {audienceProgress ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {audienceProgress}
              </span>
            ) : audienceResult ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {audienceResult}
              </span>
            ) : null}
          </div>
          {audienceError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{audienceError}</p>
          ) : null}

          {xHandle != null ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {alreadyLiked ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                  Liked
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onLike}
                  disabled={isLiking || !canLike}
                  title={canLike ? undefined : "You've hit today's like limit."}
                  className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {isLiking ? "Liking…" : "Like"}
                </button>
              )}

              {alreadyFollowedAuthor ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                  Following
                </span>
              ) : confirmingFollow ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <span>Follow {tweet.author_handle ?? "this author"}?</span>
                  <button
                    type="button"
                    onClick={onFollow}
                    disabled={isFollowing || !canFollow}
                    title={canFollow ? undefined : "You've hit today's follow limit."}
                    className="rounded-full bg-amber-800 px-3 py-1 font-medium text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                  >
                    {isFollowing ? "Following…" : "Yes, follow"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingFollow(false)}
                    className="rounded-full px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingFollow(true)}
                  disabled={!canFollow}
                  title={canFollow ? undefined : "You've hit today's follow limit."}
                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Follow
                </button>
              )}
            </div>
          ) : null}
          {likeError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{likeError}</p>
          ) : null}
          {followError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{followError}</p>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {drafts.map((draft) => {
              const tweetHasPostedDraft = drafts.some((d) => d.status === "posted");
              const isPosting = postingIds.has(draft.id);
              const postError = postErrors[draft.id];
              const isMarkingPosted = markingPostedIds.has(draft.id);
              const markPostedError = markPostedErrors[draft.id];
              const isGrokQuestion = draft.variant === GROK_VARIANT;

              return (
                <div
                  key={draft.id}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {isGrokQuestion ? (
                    <span
                      className="w-fit rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                      title="Tags @grok so it answers publicly in the thread."
                    >
                      Ask @grok
                    </span>
                  ) : (
                    // The two reply drafts are deliberately two different
                    // shapes, so the choice between them is a choice
                    // between kinds of comment, not two wordings.
                    <TypeChip type={draft.draft_type} />
                  )}
                  <p className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">
                    {draft.draft_text}
                  </p>
                  <CtaToggle
                    cta={draft.draft_cta}
                    on={ctaOn.has(draft.id)}
                    onToggle={() => toggleCta(draft.id)}
                  />
                  <div className="flex items-center justify-between">
                    {/* Counts what would actually be posted, CTA
                        included — the pair is written to fit under 280
                        together, and this is where you would see it if
                        one ever did not. */}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {textOf(draft).length}/280
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy(draft)}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        {copiedId === draft.id ? "Copied" : "Copy"}
                      </button>

                      {/* Copies, then opens X's reply composer in a new
                          tab with the text already in it. The primary
                          action whenever HeatCheck cannot send the reply
                          itself, since it is the shortest path that
                          works. */}
                      {draft.status === "posted" || tweetHasPostedDraft ? null : (
                        <button
                          type="button"
                          onClick={() => handleCopyAndPost(draft)}
                          title="Copies the reply and opens it in X's reply box in a new tab — you press Post there."
                          className={
                            canAutoReply
                              ? "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              : "rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          }
                        >
                          Copy &amp; Post ↗
                        </button>
                      )}

                      {draft.status === "posted" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                          Posted
                          {draft.posted_x_tweet_id ? (
                            <a
                              href={`https://x.com/i/status/${draft.posted_x_tweet_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-dotted underline-offset-2"
                            >
                              View →
                            </a>
                          ) : null}
                        </span>
                      ) : tweetHasPostedDraft ? (
                        <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                          Already replied
                        </span>
                      ) : (
                        <>
                          {xHandle != null && canAutoReply ? (
                            <button
                              type="button"
                              onClick={() => onPost(draft.id, ctaOn.has(draft.id))}
                              disabled={isPosting}
                              className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                              {isPosting ? "Posting…" : "Post"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onMarkPosted(draft.id)}
                            disabled={isMarkingPosted}
                            title="I copied this and replied myself on X — no API call, no risk to your account."
                            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                          >
                            {isMarkingPosted ? "Marking…" : "Mark posted"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {postError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {postError}
                    </p>
                  ) : null}
                  {markPostedError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {markPostedError}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isRegenerating || !canRegenerate}
              title={
                canRegenerate
                  ? undefined
                  : "You've hit today's regeneration limit."
              }
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isRegenerating ? "Regenerating…" : "Regenerate"}
            </button>

            {confirmingDelete ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <span>Delete this tweet and its drafts?</span>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="rounded-full bg-amber-800 px-3 py-1 font-medium text-white hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                >
                  {isDeleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-full px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
