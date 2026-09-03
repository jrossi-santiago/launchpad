"use client";

import { Fragment, useMemo, useState } from "react";

export type LeadRow = {
  id: string;
  x_username: string;
  name: string | null;
  bio: string | null;
  followers_count: number | null;
  tweet_id: string | null;
  source: string | null;
  status: string;
  created_at: string;
  outreach_draft: string | null;
  reply_tweet_id: string | null;
  reply_text: string | null;
};

export type SourceTweet = {
  id: string;
  authorHandle: string;
  content: string;
  url: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  replied: "Replied",
  retweeted: "Retweeted",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  drafted: "Drafted",
  replied: "Replied",
  skipped: "Skipped",
};

const TOTAL_COLUMNS = 10;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function LeadsTable({
  initialLeads,
  sourceTweets,
  hasPack,
}: {
  initialLeads: LeadRow[];
  sourceTweets: SourceTweet[];
  hasPack: boolean;
}) {
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const sourceTweetById = useMemo(() => {
    const map = new Map<string, SourceTweet>();
    for (const tweet of sourceTweets) map.set(tweet.id, tweet);
    return map;
  }, [sourceTweets]);

  const visibleLeads = useMemo(() => {
    const filtered =
      sourceFilter === "all"
        ? leads
        : leads.filter((lead) => lead.tweet_id === sourceFilter);

    return [...filtered].sort((a, b) => {
      const aFollowers = a.followers_count ?? 0;
      const bFollowers = b.followers_count ?? 0;
      return sortDirection === "asc" ? aFollowers - bFollowers : bFollowers - aFollowers;
    });
  }, [leads, sourceFilter, sortDirection]);

  const allVisibleSelected =
    visibleLeads.length > 0 && visibleLeads.every((lead) => selectedIds.has(lead.id));

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const lead of visibleLeads) next.delete(lead.id);
      } else {
        for (const lead of visibleLeads) next.add(lead.id);
      }
      return next;
    });
  }

  function toggleSelect(leadId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  async function handleGenerateDrafts() {
    if (generating || selectedIds.size === 0 || !hasPack) return;

    setGenerating(true);
    setGenerateError(null);

    try {
      const response = await fetch("/api/leads/generate-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_ids: Array.from(selectedIds) }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Generate Drafts failed (${response.status}).`);
      }

      const { leads: updatedLeads } = body as { leads: LeadRow[] };
      const byId = new Map(updatedLeads.map((lead) => [lead.id, lead]));

      setLeads((prev) => prev.map((lead) => byId.get(lead.id) ?? lead));
      setSelectedIds(new Set());
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to generate drafts.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(lead: LeadRow) {
    if (!lead.outreach_draft) return;
    try {
      await navigator.clipboard.writeText(lead.outreach_draft);
      setCopiedId(lead.id);
      setTimeout(() => {
        setCopiedId((current) => (current === lead.id ? null : current));
      }, 1500);
    } catch {
      // Clipboard access denied or unavailable in this browser context.
    }
  }

  async function handleSetStatus(leadId: string, status: "replied" | "skipped") {
    if (markingIds.has(leadId)) return;

    setMarkingIds((prev) => new Set(prev).add(leadId));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[leadId];
      return next;
    });

    try {
      const response = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, status }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Update failed (${response.status}).`);
      }

      const { lead: updated } = body as { lead: LeadRow };
      setLeads((prev) => prev.map((lead) => (lead.id === updated.id ? updated : lead)));
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [leadId]: err instanceof Error ? err.message : "Failed to update that lead.",
      }));
    } finally {
      setMarkingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  async function handleSend(leadId: string) {
    if (sendingIds.has(leadId)) return;

    setSendingIds((prev) => new Set(prev).add(leadId));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[leadId];
      return next;
    });

    try {
      const response = await fetch("/api/leads/send-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Send failed (${response.status}).`);
      }

      const { lead: updated } = body as { lead: LeadRow };
      setLeads((prev) => prev.map((lead) => (lead.id === updated.id ? updated : lead)));
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [leadId]: err instanceof Error ? err.message : "Failed to send that reply.",
      }));
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  async function handleDelete(leadIds: string[]) {
    if (leadIds.length === 0) return;

    setDeletingIds((prev) => {
      const next = new Set(prev);
      for (const id of leadIds) next.add(id);
      return next;
    });
    setDeleteError(null);

    try {
      const response = await fetch("/api/leads/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_ids: leadIds }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? `Delete failed (${response.status}).`);
      }

      const idSet = new Set(leadIds);
      setLeads((prev) => prev.filter((lead) => !idSet.has(lead.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of leadIds) next.delete(id);
        return next;
      });
      setExpandedId((prev) => (prev && idSet.has(prev) ? null : prev));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete leads.");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        for (const id of leadIds) next.delete(id);
        return next;
      });
    }
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-24 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No leads yet.
        </p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Pull a tweet&apos;s audience from Launchpad to bring repliers and
          retweeters in here as warm leads.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-500 dark:text-zinc-400" htmlFor="source-tweet-filter">
            Source tweet
          </label>
          <select
            id="source-tweet-filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="all">All tweets</option>
            {sourceTweets.map((tweet) => (
              <option key={tweet.id} value={tweet.id}>
                {tweet.authorHandle}: &quot;{truncate(tweet.content, 60)}&quot;
              </option>
            ))}
          </select>
        </div>

        <a
          href="/api/leads/export"
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Export CSV
        </a>
      </div>

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={() => void handleGenerateDrafts()}
            disabled={generating || !hasPack}
            title={hasPack ? undefined : "Create a Brand Pack first."}
            className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {generating
              ? "Generating…"
              : `Generate Drafts (${selectedIds.size} selected)`}
          </button>
          {!hasPack ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Create a Brand Pack first —{" "}
              <a href="/home" className="underline decoration-dotted underline-offset-2">
                go to /home
              </a>
              .
            </span>
          ) : null}
          {generateError ? (
            <span className="text-xs text-red-600 dark:text-red-400">{generateError}</span>
          ) : null}

          {confirmingBulkDelete ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <span>
                Delete {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"}?
              </span>
              <button
                type="button"
                onClick={() => {
                  const ids = Array.from(selectedIds);
                  setConfirmingBulkDelete(false);
                  void handleDelete(ids);
                }}
                className="rounded-full bg-red-700 px-3 py-1 font-medium text-white hover:bg-red-800 dark:bg-red-400 dark:text-red-950 dark:hover:bg-red-300"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingBulkDelete(false)}
                className="rounded-full px-3 py-1 font-medium text-red-800 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingBulkDelete(true)}
              className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete ({selectedIds.size} selected)
            </button>
          )}

          {deleteError ? (
            <span className="text-xs text-red-600 dark:text-red-400">{deleteError}</span>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <th className="w-10 px-4 py-3 font-medium">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  aria-label="Select all visible leads"
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                />
              </th>
              <th className="px-4 py-3 font-medium">Handle</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Bio</th>
              <th className="px-4 py-3 font-medium">
                <button
                  type="button"
                  onClick={() =>
                    setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
                  }
                  className="inline-flex items-center gap-1 font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Followers {sortDirection === "asc" ? "▲" : "▼"}
                </button>
              </th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Source tweet</th>
              <th className="px-4 py-3 font-medium">Added</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => {
              const isExpanded = expandedId === lead.id;
              const hasDraft = lead.outreach_draft != null;
              const isSending = sendingIds.has(lead.id);
              const isMarking = markingIds.has(lead.id);
              const actionError = actionErrors[lead.id];
              const sourceTweet = lead.tweet_id ? sourceTweetById.get(lead.tweet_id) : undefined;

              return (
                <Fragment key={lead.id}>
                  <tr
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        aria-label={`Select @${lead.x_username}`}
                        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://x.com/${lead.x_username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                      >
                        @{lead.x_username}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {lead.name ?? "—"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {lead.bio ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {lead.followers_count ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {SOURCE_LABELS[lead.source ?? ""] ?? lead.source ?? "—"}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {sourceTweet
                        ? `${sourceTweet.authorHandle}: "${truncate(sourceTweet.content, 60)}"`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {STATUS_LABELS[lead.status] ?? lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        {isExpanded ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td colSpan={TOTAL_COLUMNS} className="bg-zinc-50 px-6 py-4 dark:bg-zinc-950">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            Why this lead
                          </p>
                          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            @{lead.x_username}{" "}
                            {lead.source === "retweeted" ? "retweeted" : "replied to"} this post
                            {sourceTweet ? ` from ${sourceTweet.authorHandle}` : ""}
                            {sourceTweet?.url ? (
                              <>
                                {" "}
                                —{" "}
                                <a
                                  href={sourceTweet.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-dotted underline-offset-2"
                                >
                                  view original →
                                </a>
                              </>
                            ) : null}
                          </p>
                          {sourceTweet ? (
                            <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                              {sourceTweet.content}
                            </blockquote>
                          ) : null}

                          {lead.source === "replied" && lead.reply_text ? (
                            <>
                              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                Their reply
                              </p>
                              <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                                {lead.reply_text}
                              </blockquote>
                            </>
                          ) : null}
                        </div>

                        {hasDraft ? (
                          <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                              Outreach draft
                            </p>
                            <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                              {lead.outreach_draft}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleCopy(lead)}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              >
                                {copiedId === lead.id ? "Copied" : "Copy"}
                              </button>

                              {lead.reply_tweet_id ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSend(lead.id)}
                                  disabled={isSending || lead.status === "replied"}
                                  className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                                >
                                  {lead.status === "replied"
                                    ? "Sent"
                                    : isSending
                                      ? "Sending…"
                                      : "Send"}
                                </button>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => void handleSetStatus(lead.id, "replied")}
                                disabled={isMarking || lead.status === "replied"}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              >
                                Mark replied
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleSetStatus(lead.id, "skipped")}
                                disabled={isMarking || lead.status === "skipped"}
                                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              >
                                Skip
                              </button>
                            </div>
                            {actionError ? (
                              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                {actionError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-5 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
                            No outreach draft yet — select this lead and click Generate
                            Drafts to write one.
                          </p>
                        )}

                        <div className="mt-4 flex items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                          {confirmingDeleteId === lead.id ? (
                            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                              <span>Delete this lead?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmingDeleteId(null);
                                  void handleDelete([lead.id]);
                                }}
                                disabled={deletingIds.has(lead.id)}
                                className="rounded-full bg-red-700 px-3 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-400 dark:text-red-950 dark:hover:bg-red-300"
                              >
                                Yes, delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                className="rounded-full px-3 py-1 font-medium text-red-800 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(lead.id)}
                              disabled={deletingIds.has(lead.id)}
                              className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                            >
                              {deletingIds.has(lead.id) ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
