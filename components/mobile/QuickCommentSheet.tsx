"use client";

import { useEffect, useState } from "react";
import { TypeChip } from "@/components/comment/TypeChip";
import { CtaToggle } from "@/components/comment/CtaToggle";
import { copyAndOpenReply, withCta } from "@/lib/x/intent";

export type QuickTarget = {
  // The post being replied to. `cardId` is set when it came from the Feed,
  // `fetched` when it was looked up by id — whichever it is, that's what
  // "Draft replies for this post" needs to put it in the queue.
  xTweetId: string;
  authorHandle: string;
  content: string;
  cardId?: string;
  fetched?: unknown;
  // The reply a Feed Reload already wrote for this post, if it had one.
  // It opens with the sheet, so the sheet is never emptier than the card
  // it was opened from — and it brings its CTA with it, so turning the
  // ask on works the same here as it does on the card.
  suggestion?: string | null;
  suggestionCta?: string | null;
  suggestionType?: unknown;
};

export type QuickDraft = {
  id: string;
  text: string;
  cta: string | null;
  // Which of the four comment types this draft is, when it has one. The
  // @grok draft does not.
  type?: unknown;
};

export type DraftsState = "idle" | "working" | "ready" | "failed";

// A comment you can send without waiting for anything. Templates come
// straight out of the brand pack, so the sheet is useful the instant it
// opens; drafts are the three Haiku replies written for this specific
// post, which only exist once the post is in the queue.
function Comment({
  text,
  cta,
  source,
  type,
  onSend,
  sent,
}: {
  text: string;
  // Null on templates and on the @grok draft, which never carry one.
  cta?: string | null;
  source: string;
  // Shown beside the source line, so the sheet says what shape this
  // comment is the same way the cards do.
  type?: unknown;
  // Given the text as it stands — comment alone, or comment plus the CTA
  // this one is showing — so the sheet sends exactly what is on screen.
  onSend: (text: string) => void;
  sent: boolean;
}) {
  const [ctaOn, setCtaOn] = useState(false);
  const full = withCta(text, ctaOn ? (cta ?? null) : null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
          {source}
        </span>
        <TypeChip type={type} />
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
        {text}
      </p>
      <CtaToggle
        cta={cta ?? null}
        on={ctaOn}
        onToggle={() => setCtaOn((on) => !on)}
      />
      <button
        type="button"
        onClick={() => onSend(full)}
        className="min-h-11 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {sent ? "Copied — finish in X ↗" : "Copy & open X ↗"}
      </button>
    </div>
  );
}

type SheetProps = {
  target: QuickTarget | null;
  templates: string[];
  drafts: QuickDraft[];
  draftsState: DraftsState;
  draftsError: string | null;
  onRequestDrafts: () => void;
  onMarkPosted: (draftId: string) => void;
  onClose: () => void;
};

// Mounted only while a post is open, and keyed on that post, so every bit
// of sheet state — what you copied, what is waiting to be marked posted —
// starts clean for the next one without an effect resetting it.
export function QuickCommentSheet(props: SheetProps) {
  if (!props.target) return null;
  return (
    <SheetBody {...props} key={props.target.xTweetId} target={props.target} />
  );
}

function SheetBody({
  target,
  templates,
  drafts,
  draftsState,
  draftsError,
  onRequestDrafts,
  onMarkPosted,
  onClose,
}: SheetProps & { target: QuickTarget }) {
  const [sentText, setSentText] = useState<string | null>(null);
  // Set when a draft (not a template) was handed to X, so there is a row
  // to mark posted when the user comes back.
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [askPosted, setAskPosted] = useState(false);

  // Coming back from X is the only reliable signal that the round trip
  // happened — there is no callback from the composer. So the question is
  // asked on return rather than left as a button to find later.
  useEffect(() => {
    if (!pendingDraftId) return;

    function onVisible() {
      if (document.visibilityState === "visible") setAskPosted(true);
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pendingDraftId]);

  // Matched on the prefix, not on equality: what was sent may carry a CTA
  // the comment itself does not, and it is still the same comment.
  function wasSent(text: string): boolean {
    return sentText !== null && sentText.startsWith(text);
  }

  function send(text: string, draftId: string | null) {
    copyAndOpenReply(target.xTweetId, text);
    setSentText(text);
    if (draftId) setPendingDraftId(draftId);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        aria-label="Close quick comments"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[1px]"
      />

      <div
        role="dialog"
        aria-label="Quick comments"
        className="relative flex max-h-[85dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-lg md:rounded-2xl md:border dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Quick comments
          </h2>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            tap = copy + open X
          </span>
        </div>

        <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          Replying to {target.authorHandle}: {target.content}
        </p>

        {askPosted && pendingDraftId ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <span className="text-sm text-emerald-800 dark:text-emerald-200">
              Did that go up?
            </span>
            <button
              type="button"
              onClick={() => {
                onMarkPosted(pendingDraftId);
                setPendingDraftId(null);
                setAskPosted(false);
                onClose();
              }}
              className="ml-auto min-h-9 rounded-full bg-emerald-700 px-3.5 py-1.5 text-xs font-medium text-white"
            >
              Mark posted
            </button>
            <button
              type="button"
              onClick={() => setAskPosted(false)}
              className="min-h-9 px-2 text-xs font-medium text-emerald-800 dark:text-emerald-200"
            >
              Not yet
            </button>
          </div>
        ) : null}

        {target.suggestion ? (
          <Comment
            text={target.suggestion}
            cta={target.suggestionCta}
            source="Haiku · written on Reload"
            type={target.suggestionType}
            sent={wasSent(target.suggestion)}
            onSend={(text) => send(text, null)}
          />
        ) : null}

        {drafts.map((draft) => (
          <Comment
            key={draft.id}
            text={draft.text}
            cta={draft.cta}
            source="Haiku · written for this post"
            type={draft.type}
            sent={wasSent(draft.text)}
            onSend={(text) => send(text, draft.id)}
          />
        ))}

        {templates.map((template, index) => (
          <Comment
            key={`template-${index}`}
            text={template}
            source="Template · your voice"
            sent={wasSent(template)}
            onSend={(text) => send(text, null)}
          />
        ))}

        {templates.length === 0 && drafts.length === 0 && !target.suggestion ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Your brand pack has no reply templates yet. Add some on Home and
            they show up here instantly.
          </p>
        ) : null}

        {draftsError ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">{draftsError}</p>
        ) : null}

        {draftsState !== "ready" ? (
          <button
            type="button"
            onClick={onRequestDrafts}
            disabled={draftsState === "working"}
            className="min-h-11 rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {draftsState === "working"
              ? "Writing three replies…"
              : target.suggestion
                ? "Write three more for this post"
                : "Draft replies for this post"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="min-h-11 text-sm font-medium text-zinc-500 dark:text-zinc-400"
        >
          Close
        </button>
      </div>
    </div>
  );
}
