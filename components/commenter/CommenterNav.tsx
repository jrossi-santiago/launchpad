"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Commenter is one job in three views: the stream of posts from the
// accounts you watch, the queue of posts you kept — which is where the
// written drafts live — and Room 2, the same loop pointed at the few
// buyers you are working one at a time. Segments rather than tabs,
// because choosing between them is not a navigation decision — it is
// "am I picking, am I sending, or am I working someone".
const SEGMENTS = [
  { href: "/commenter", label: "Feed" },
  { href: "/commenter/queue", label: "Queue" },
  { href: "/commenter/room2", label: "Room 2" },
] as const;

export function CommenterNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Commenter"
      className="mb-4 inline-flex gap-1 self-start rounded-full border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {SEGMENTS.map((segment) => {
        const isActive = pathname === segment.href;
        return (
          <Link
            key={segment.href}
            href={segment.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            {segment.label}
          </Link>
        );
      })}
    </nav>
  );
}
