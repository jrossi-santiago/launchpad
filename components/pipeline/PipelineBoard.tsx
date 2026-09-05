"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PipelineBoard as Board, PipelineCard } from "@/lib/pipeline/board";
import {
  BACKLOG_CAP,
  LIVE_CAP,
  WAITLIST_CAP,
  type Icp,
} from "@/lib/pipeline/rules";
import {
  ACTION_CLASSES,
  ICP_LABELS,
  STATUS_LABELS,
  daysAgo,
  postJson,
} from "@/components/pipeline/shared";

export type WaitlistCandidate = {
  id: string;
  x_username: string;
  name: string | null;
  bio: string | null;
  source: string | null;
  source_post_url: string | null;
};

const COLUMN_CLASS =
  "flex min-w-0 flex-1 flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950";

// The three columns, and the only place a lead changes lane. Room 2 does
// the commenting; this page decides who is in the room.
export function PipelineBoard({
  board,
  candidates,
}: {
  board: Board;
  candidates: WaitlistCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(
    new Set(),
  );

  const roomFull = board.liveCount >= board.liveCap;

  async function run(id: string, work: () => Promise<string | null>) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      if (message) setNotice(message);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  function act(leadId: string, action: string) {
    void run(leadId, async () => {
      await postJson("/api/pipeline/status", { lead_id: leadId, action });
      return null;
    });
  }

  function setIcp(leadId: string, icp: Icp) {
    void run(leadId, async () => {
      await postJson("/api/pipeline/lead", { lead_id: leadId, icp });
      return null;
    });
  }

  function addSelectedCandidates(icp: Icp) {
    const ids = Array.from(selectedCandidates);
    if (ids.length === 0) return;

    const sourceUrl =
      candidates.find((c) => c.id === ids[0])?.source_post_url ?? null;

    void run("add-candidates", async () => {
      const body = (await postJson("/api/pipeline/add", {
        lead_ids: ids,
        icp,
        source_post_url: sourceUrl,
      })) as { added?: number; already_in_pipeline?: number; over_cap?: number };

      setSelectedCandidates(new Set());

      const parts = [`Added ${body.added ?? 0} to the waitlist.`];
      if (body.already_in_pipeline) {
        parts.push(`${body.already_in_pipeline} were already in the pipeline.`);
      }
      if (body.over_cap) {
        parts.push(`${body.over_cap} didn't fit under the ${WAITLIST_CAP} cap.`);
      }
      return parts.join(" ");
    });
  }

  function addHandle() {
    const handle = handleInput.trim();
    if (!handle) return;

    void run("add-handle", async () => {
      await postJson("/api/pipeline/add", { handle, icp: "unrated" });
      setHandleInput("");
      return `Added ${handle} to the waitlist.`;
    });
  }

  function setCap(cap: number) {
    void run("cap", async () => {
      await postJson("/api/pipeline/cap", { cap });
      return `Working ${cap} at a time.`;
    });
  }

  const busy = busyId !== null || pending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span>Working</span>
          <select
            value={board.liveCap}
            onChange={(e) => setCap(Number(e.target.value))}
            disabled={busy}
            aria-label="How many people to work at once"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {Array.from({ length: LIVE_CAP }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>
            at a time · {board.liveCount} live now
            {roomFull ? " · room full" : ""}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {showAdd ? "Done adding" : "Add to waitlist"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {notice}
        </p>
      ) : null}

      {showAdd ? (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              Add by handle
              <input
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                placeholder="@handle or profile URL"
                className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>
            <button
              type="button"
              onClick={addHandle}
              disabled={busy || !handleInput.trim()}
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              Add
            </button>
          </div>

          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              From your Leads — repliers and reposters pulled off your own
              posts, minus anyone already in the pipeline.
            </p>

            {candidates.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Nothing new. Pull a post&apos;s audience from the Queue to bring
                people in.
              </p>
            ) : (
              <>
                <ul className="mt-3 max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {candidates.map((candidate) => (
                    <li
                      key={candidate.id}
                      className="flex items-start gap-3 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCandidates.has(candidate.id)}
                        onChange={() =>
                          setSelectedCandidates((prev) => {
                            const next = new Set(prev);
                            if (next.has(candidate.id)) next.delete(candidate.id);
                            else next.add(candidate.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${candidate.x_username}`}
                        className="mt-1 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          @{candidate.x_username}
                          {candidate.source === "replied" ? (
                            <span className="ml-2 text-xs font-normal text-zinc-400">
                              replied
                            </span>
                          ) : candidate.source === "retweeted" ? (
                            <span className="ml-2 text-xs font-normal text-zinc-400">
                              reposted
                            </span>
                          ) : null}
                        </span>
                        {candidate.bio ? (
                          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {candidate.bio}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addSelectedCandidates("yes")}
                    disabled={busy || selectedCandidates.size === 0}
                    className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    Add {selectedCandidates.size || ""} as ICP yes
                  </button>
                  <button
                    type="button"
                    onClick={() => addSelectedCandidates("unrated")}
                    disabled={busy || selectedCandidates.size === 0}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Add unrated
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row">
        <Column
          title="Waitlist"
          count={board.waitlist.length}
          cap={WAITLIST_CAP}
          hint="Parked. No commenting happens here."
        >
          {board.waitlist.map((card) => (
            <WaitlistRow
              key={card.lead.id}
              card={card}
              disabled={busy}
              roomFull={roomFull}
              onPromote={() => act(card.lead.id, "live")}
              onSkip={() => act(card.lead.id, "skipped")}
              onIcp={(icp) => setIcp(card.lead.id, icp)}
            />
          ))}
        </Column>

        <Column
          title="Live"
          count={board.live.length}
          cap={board.liveCap}
          hint="Room 2. The only people you're prompted to comment on."
        >
          {board.live.map((card) => (
            <LiveRow
              key={card.lead.id}
              card={card}
              disabled={busy}
              confirming={confirmingReplace === card.lead.id}
              onConfirmReplace={() => setConfirmingReplace(card.lead.id)}
              onCancelReplace={() => setConfirmingReplace(null)}
              onReplace={() => {
                setConfirmingReplace(null);
                act(card.lead.id, "replace");
              }}
              onKeep={() => {
                setConfirmingReplace(null);
                act(card.lead.id, "keep");
              }}
              onSkipForever={() => {
                setConfirmingReplace(null);
                act(card.lead.id, "skipped");
              }}
            />
          ))}
        </Column>

        <Column
          title="Backlog"
          count={board.backlog.length}
          cap={BACKLOG_CAP}
          hint="Cold, said no, or not now. Rechecked if they show up again."
        >
          {board.backlog.map((card) => (
            <BacklogRow key={card.lead.id} card={card} />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  cap,
  hint,
  children,
}: {
  title: string;
  count: number;
  cap: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={COLUMN_CLASS}>
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {title}{" "}
          <span className="font-normal text-zinc-400">
            {count}/{cap}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      </div>

      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
          Empty
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </div>
  );
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </li>
  );
}

function Handle({ card }: { card: PipelineCard }) {
  return (
    <a
      href={`https://x.com/${card.lead.handle}`}
      target="_blank"
      rel="noreferrer"
      className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
    >
      @{card.lead.handle}
    </a>
  );
}

function WaitlistRow({
  card,
  disabled,
  roomFull,
  onPromote,
  onSkip,
  onIcp,
}: {
  card: PipelineCard;
  disabled: boolean;
  roomFull: boolean;
  onPromote: () => void;
  onSkip: () => void;
  onIcp: (icp: Icp) => void;
}) {
  return (
    <RowShell>
      <div className="flex items-start justify-between gap-2">
        <Handle card={card} />
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {ICP_LABELS[card.lead.icp]}
        </span>
      </div>

      {card.lead.bio_snippet ? (
        <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          {card.lead.bio_snippet}
        </p>
      ) : null}

      {card.lead.source_post_url ? (
        <a
          href={card.lead.source_post_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-400 underline decoration-dotted underline-offset-2"
        >
          Came from your post
          {card.lead.source_type ? ` · ${card.lead.source_type}` : ""}
        </a>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onPromote}
          disabled={disabled || roomFull}
          title={roomFull ? "Room 2 is full — replace someone first." : undefined}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          Move to live
        </button>
        {card.lead.icp !== "yes" ? (
          <button
            type="button"
            onClick={() => onIcp("yes")}
            disabled={disabled}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ICP yes
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Skip
        </button>
      </div>
    </RowShell>
  );
}

function LiveRow({
  card,
  disabled,
  confirming,
  onConfirmReplace,
  onCancelReplace,
  onReplace,
  onKeep,
  onSkipForever,
}: {
  card: PipelineCard;
  disabled: boolean;
  confirming: boolean;
  onConfirmReplace: () => void;
  onCancelReplace: () => void;
  onReplace: () => void;
  onKeep: () => void;
  onSkipForever: () => void;
}) {
  const { lead, nextAction } = card;

  return (
    <RowShell>
      <div className="flex items-start justify-between gap-2">
        <Handle card={card} />
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {STATUS_LABELS[lead.status]}
        </span>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {lead.our_comment_count} comment{lead.our_comment_count === 1 ? "" : "s"} ·{" "}
        {daysAgo(lead.moved_to_live_at)} live · last signal{" "}
        {daysAgo(lead.last_signal_at)}
      </p>

      <span
        className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ACTION_CLASSES[nextAction.kind]}`}
      >
        {nextAction.label}
      </span>
      <p className="text-[11px] text-zinc-400">{nextAction.detail}</p>

      {card.replaceSuggested ? (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs dark:border-red-900 dark:bg-red-950">
            <span className="text-red-800 dark:text-red-300">
              Dump @{lead.handle} and pull next from waitlist?
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={onReplace}
                disabled={disabled}
                className="rounded-full bg-red-700 px-3 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-40 dark:bg-red-400 dark:text-red-950"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={onKeep}
                disabled={disabled}
                className="rounded-full border border-red-300 px-3 py-1 font-medium text-red-700 hover:bg-red-100 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
              >
                Keep 7 days
              </button>
              <button
                type="button"
                onClick={onSkipForever}
                disabled={disabled}
                className="rounded-full border border-red-300 px-3 py-1 font-medium text-red-700 hover:bg-red-100 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
              >
                Skip forever
              </button>
              <button
                type="button"
                onClick={onCancelReplace}
                className="rounded-full px-3 py-1 font-medium text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConfirmReplace}
            disabled={disabled}
            className="w-fit rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            Replace…
          </button>
        )
      ) : null}
    </RowShell>
  );
}

function BacklogRow({ card }: { card: PipelineCard }) {
  return (
    <RowShell>
      <div className="flex items-start justify-between gap-2">
        <Handle card={card} />
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {STATUS_LABELS[card.lead.status]}
        </span>
      </div>
      <p className="text-xs text-zinc-400">
        {card.lead.our_comment_count} comment
        {card.lead.our_comment_count === 1 ? "" : "s"} ·{" "}
        {card.lead.their_reply_count} repl
        {card.lead.their_reply_count === 1 ? "y" : "ies"} back · dropped{" "}
        {daysAgo(card.lead.updated_at)} ago
      </p>
    </RowShell>
  );
}
