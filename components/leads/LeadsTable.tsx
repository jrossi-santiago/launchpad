"use client";

import { useMemo, useState } from "react";

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
};

const SOURCE_LABELS: Record<string, string> = {
  replied: "Replied",
  retweeted: "Retweeted",
};

export function LeadsTable({
  initialLeads,
  sourceTweets,
}: {
  initialLeads: LeadRow[];
  sourceTweets: { id: string; label: string }[];
}) {
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const sourceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tweet of sourceTweets) map.set(tweet.id, tweet.label);
    return map;
  }, [sourceTweets]);

  const visibleLeads = useMemo(() => {
    const filtered =
      sourceFilter === "all"
        ? initialLeads
        : initialLeads.filter((lead) => lead.tweet_id === sourceFilter);

    return [...filtered].sort((a, b) => {
      const aFollowers = a.followers_count ?? 0;
      const bFollowers = b.followers_count ?? 0;
      return sortDirection === "asc" ? aFollowers - bFollowers : bFollowers - aFollowers;
    });
  }, [initialLeads, sourceFilter, sortDirection]);

  if (initialLeads.length === 0) {
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
              {tweet.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
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
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
              >
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
                  {lead.tweet_id ? sourceLabelById.get(lead.tweet_id) ?? "—" : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
