"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Four destinations, because a thumb reaching the bottom of a phone can
// hold about that many: the two things worth replying to (people you
// watch, strangers who match your brand pack), the one thing that is
// only worth doing while it is still hot, and everything about you.
// Queue, Network, Radar and Leads are still there — they live one tap
// deeper, under You.
const TABS = [
  {
    href: "/feed",
    label: "Feed",
    // Three stacked lines: one stream, many accounts.
    path: "M4 6h16M4 12h16M4 18h10",
  },
  {
    href: "/explore",
    label: "Explore",
    path: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-1.5 5.5L20 20",
  },
  {
    href: "/heatcheck",
    label: "HeatCheck",
    // A flame: the posts that are burning right now.
    path: "M12 3c.6 3-1.2 4.2-2.6 5.6A5.8 5.8 0 0 0 7.5 13a4.5 4.5 0 0 0 9 0c0-1.7-.8-2.9-1.7-3.9-.6 1-1.3 1.4-2 1.6.6-2.4.3-5.4-.8-7.7Z",
  },
  {
    href: "/settings",
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
        const isActive = pathname === tab.href;
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
