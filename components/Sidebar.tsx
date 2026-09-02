"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const primaryNav = [
  { href: "/home", label: "Home" },
  { href: "/radar", label: "Radar" },
  { href: "/launchpad", label: "Launchpad" },
  { href: "/leads", label: "Leads" },
] as const;

export function Sidebar({
  email,
  plan,
}: {
  email: string;
  plan: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-5 py-6">
        <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Launchpad
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {primaryNav.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-zinc-200 px-3 py-4 dark:border-zinc-800">
        <Link
          href="/settings"
          className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            pathname === "/settings"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          }`}
        >
          Settings
        </Link>

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
