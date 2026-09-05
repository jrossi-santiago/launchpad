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
  // What the model said it could not tell about this post, when it read
  // it and declined. It is the seed for the three write-one buttons: on
  // "I'll fill the gap" it is the question the founder is answering, so
  // the sheet shows it rather than making them remember it.
  unclear?: string | null;
};

// One comment written on demand for a post the model declined, and the
// state of writing it.
//
// The three buttons live on the card, in the amber block that says the
// post was read and not answered. The result lands here, because the
// sheet is already the place a comment is read, edited, CTA'd and sent —
// duplicating that furniture on the card would mean maintaining two
// review surfaces that must agree.
//
// `note` is the state "I'll fill the gap" opens in: nothing has been
// written yet, and nothing will be until the founder types the piece the
// model was missing.
export type AssistMode = "grok" | "ask" | "steer";

export type AssistState = {
  mode: AssistMode;
  state: "note" | "working" | "ready" | "failed";
  text: string;
  type: unknown;
  error: string | null;
};

const ASSIST_LABELS: Record<AssistMode, { title: string; working: string }> = {
  grok: {
    title: "@grok question",
    working: "Writing a question for Grok…",
  },
  ask: {
    title: "Question for the author",
    working: "Writing the question…",
  },
  steer: {
    title: "Written from what you told it",
    working: "Writing it with your note…",
  },
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

// The write-one panel: the note box, the wait, and the comment that comes
// back — editable before it goes anywhere.
//
// Editable is the point of routing the result here. The three buttons
// exist because the founder knows something the model does not, and a
// comment written from a one-line note is a first draft of what they
// would have typed themselves. Handing it back as read-only text would
// make them retype it in X to fix one word; handing it back in a box
// means the last edit is theirs and the copy button copies what they can
// see.
function AssistPanel({
  assist,
  unclear,
  onRun,
  onSend,
  sent,
}: {
  assist: AssistState;
  unclear: string | null;
  onRun: (note: string | null) => void;
  onSend: (text: string) => void;
  sent: (text: string) => boolean;
}) {
  const labels = ASSIST_LABELS[assist.mode];
  const [note, setNote] = useState("");
  // Seeded from the model and owned by the founder from the first
  // keystroke. The panel is keyed on the text it came back with, so a
  // Try again remounts it with the new comment rather than leaving the
  // previous attempt sitting in an edited box.
  const [text, setText] = useState(assist.text);

  if (assist.state === "note") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
        <span className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
          Tell it what it was missing
        </span>
        {unclear ? (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            It said: {unclear}
          </p>
        ) : null}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={400}
          autoFocus
          placeholder="What is this actually about? e.g. “this is his funding announcement — we shipped the same integration last year and it took 6 weeks”"
          className="w-full rounded-lg border border-zinc-300 bg-white p-2.5 text-sm leading-relaxed text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <button
          type="button"
          onClick={() => onRun(note.trim())}
          disabled={note.trim().length === 0}
          className="min-h-11 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Write it from that
        </button>
      </div>
    );
  }

  if (assist.state === "working") {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        {labels.working}
      </p>
    );
  }

  if (assist.state === "failed") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {assist.error ?? "Couldn't write that one."}
        </p>
        <button
          type="button"
          onClick={() => onRun(null)}
          className="min-h-11 self-start rounded-full border border-amber-300 px-4 text-sm font-medium text-amber-800 dark:border-amber-800 dark:text-amber-200"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium tracking-wider text-emerald-700 uppercase dark:text-emerald-300">
          {labels.title}
        </span>
        <TypeChip type={assist.type} />
        <span className="ml-auto text-[11px] text-emerald-700/70 dark:text-emerald-300/70">
          {text.length} chars
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        className="w-full rounded-lg border border-emerald-200 bg-white p-2.5 text-sm leading-relaxed text-zinc-800 dark:border-emerald-900 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSend(text)}
          disabled={text.trim().length === 0}
          className="min-h-11 flex-1 rounded-full bg-emerald-700 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {sent(text) ? "Copied — finish in X ↗" : "Copy & open X ↗"}
        </button>
        <button
          type="button"
          // Null every time, including for "I'll fill the gap": the note
          // is held by the Feed, not by this panel, precisely so it
          // survives the remount that a new comment causes.
          onClick={() => onRun(null)}
          title="Write another one"
          className="min-h-11 rounded-full border border-emerald-300 px-4 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:text-emerald-200"
        >
          Try again
        </button>
      </div>
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
  // Null unless one of the card's three write-one buttons was pressed.
  assist?: AssistState | null;
  // Runs the write. The note is what the founder typed in "I'll fill the
  // gap", and null for the two buttons that need nothing from them.
  onAssist?: (note: string | null) => void;
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
  assist = null,
  onAssist,
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

        {assist && onAssist ? (
          <AssistPanel
            // Keyed on the comment that came back, so Try again gets a
            // clean box rather than the previous attempt with the new
            // text ignored behind an edit flag.
            key={`${assist.mode}-${assist.state}-${assist.text}`}
            assist={assist}
            unclear={target.unclear ?? null}
            onRun={(note) => onAssist(note)}
            onSend={(text) => send(text, null)}
            sent={wasSent}
          />
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
