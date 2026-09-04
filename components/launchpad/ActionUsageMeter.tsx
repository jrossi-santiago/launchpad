import type { ActionUsage, AllActionUsage } from "@/lib/usage/actions";

function Segment({ label, usage }: { label: string; usage: ActionUsage }) {
  const atCap = usage.remaining === 0;
  return (
    <span
      className={
        atCap
          ? "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          : "px-2 py-1"
      }
    >
      {label} {usage.used}/{usage.limit}
    </span>
  );
}

export function ActionUsageMeter({ usage }: { usage: AllActionUsage }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <Segment label="Replies" usage={usage.reply} />
      <Segment label="Likes" usage={usage.like} />
      <Segment label="Follows" usage={usage.follow} />
    </div>
  );
}
