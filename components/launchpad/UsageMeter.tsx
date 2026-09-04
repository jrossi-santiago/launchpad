import type { RegenerationUsage } from "@/lib/usage/regenerations";

export function UsageMeter({ usage }: { usage: RegenerationUsage }) {
  if (usage.remaining === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        You&apos;ve used all {usage.limit} regenerations for today. Come back
        tomorrow for more.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {usage.remaining} of {usage.limit} regenerations left today
    </div>
  );
}
