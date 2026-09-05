"use client";

// The call to action, as a thing you turn on rather than a thing you
// delete.
//
// Comments are written short and complete on their own, and the ask is
// generated as a separate line. Which of the two goes out is a decision
// per post — most comments are better without one, and the few worth an
// ask are worth it because of where they land, which is something only
// the founder can see. So the CTA sits under the comment as a chip: off
// by default, one tap to attach, and whatever is showing is exactly what
// the copy button copies.
export function CtaToggle({
  cta,
  on,
  onToggle,
}: {
  cta: string | null;
  on: boolean;
  onToggle: () => void;
}) {
  if (!cta) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={`min-h-9 self-start rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          on
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }`}
      >
        {on ? "CTA on · tap to remove" : "+ CTA"}
      </button>
      {on ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
          {cta}
        </p>
      ) : null}
    </div>
  );
}
