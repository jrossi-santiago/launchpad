"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

// The same four destinations as the phone's tab bar, with the two that
// have sub-pages showing theirs inline — a laptop has the room, so the
// nesting is visible rather than one tap deeper.
const NAV = [
  { href: "/scheduler", label: "Scheduler", children: [] },
  { href: "/heatcheck", label: "HeatCheck", children: [] },
  {
    href: "/commenter",
    label: "Commenter",
    children: [{ href: "/commenter/queue", label: "Queue" }],
  },
  {
    href: "/you",
    label: "You",
    children: [
      { href: "/you/network", label: "Network" },
      { href: "/you/leads", label: "Leads" },
      { href: "/you/brand-pack", label: "Brand Pack" },
    ],
  },
] as const;

export function Sidebar({
  email,
  plan,
}: {
  email: string;
  plan: string;
}) {
  const pathname = usePathname();

  function linkClass(href: string, nested: boolean) {
    const isActive = pathname === href;
    return `rounded-lg py-2 text-sm font-medium transition-colors ${
      nested ? "pl-6 pr-3" : "px-3"
    } ${
      isActive
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    }`;
  }

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col md:flex border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-5 py-6">
        <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          HeatCheck
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map((item) => (
          <div key={item.href} className="flex flex-col gap-1">
            <Link href={item.href} className={linkClass(item.href, false)}>
              {item.label}
            </Link>
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={linkClass(child.href, true)}
              >
                {child.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-zinc-200 px-3 py-4 dark:border-zinc-800">
        <div className="px-3">
          <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
            {email}
          </p>
          <span className="mt-1 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {plan} plan
          </span>
        </div>

        <LogoutButton className="mt-3 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50" />
      </div>
    </aside>
  );
}
