"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Four destinations, because a thumb reaching the bottom of a phone can
// hold about that many: what you are going to post, what is hot enough to
// be worth a comment right now, the commenting itself — which is the
// engine — and everything about you.
//
// Queue lives under Commenter; Network, Leads and the Brand Pack live
// under You. Nothing is more than one tap deeper than it was.
const TABS = [
  {
    href: "/scheduler",
    label: "Scheduler",
    // A calendar: the posts you have lined up.
    path: "M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v11A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-11ZM4 10h16M8.5 4v3M15.5 4v3",
  },
  {
    href: "/heatcheck",
    label: "HeatCheck",
    // A flame: the posts that are burning right now.
    path: "M12 3c.6 3-1.2 4.2-2.6 5.6A5.8 5.8 0 0 0 7.5 13a4.5 4.5 0 0 0 9 0c0-1.7-.8-2.9-1.7-3.9-.6 1-1.3 1.4-2 1.6.6-2.4.3-5.4-.8-7.7Z",
  },
  {
    href: "/commenter",
    label: "Commenter",
    // A speech bubble: somebody else's thread, which is where the work is.
    path: "M20 12a7 7 0 0 1-7 7H8l-4 3v-4.6A7 7 0 0 1 6 6.5 7 7 0 0 1 13 5a7 7 0 0 1 7 7Z",
  },
  {
    href: "/you",
    label: "You",
    path: "M12 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM5 20a7 7 0 0 1 14 0",
  },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      {TABS.map((tab) => {
        // A sub-page keeps its tab lit: /commenter/queue is still
        // Commenter, /you/leads is still You.
        const isActive =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
              isActive
                ? "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-[22px] w-[22px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={isActive ? 2 : 1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={tab.path} />
            </svg>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
