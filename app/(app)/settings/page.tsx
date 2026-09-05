import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { XConnectionForm } from "@/components/settings/XConnectionForm";
import { xOAuthConfigured } from "@/lib/x/client";

// The X OAuth callback redirects back here with its outcome in the query
// string. Reading it on the server keeps the form free of useSearchParams
// (and the Suspense boundary that would need).
function readParam(
  params: { [key: string]: string | string[] | undefined },
  key: string,
): string | null {
  const value = params[key];
  if (typeof value === "string" && value) return value;
  return null;
}

const MOBILE_LINKS = [
  {
    href: "/network",
    label: "Network",
    description: "Watched accounts, one card stack each",
  },
  {
    href: "/radar",
    label: "Radar",
    description: "Search X with your own query and filters",
  },
  { href: "/leads", label: "Leads", description: "People pulled from an audience" },
  { href: "/home", label: "Brand pack", description: "Voice, ICP and reply templates" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("email, plan")
    .eq("id", user.id)
    .single();

  const email = profile?.email ?? user.email ?? "";
  const plan = profile?.plan ?? "free";

  const { data: xConnection } = await supabase
    .from("x_connections")
    .select("x_handle, auth_provider")
    .eq("user_id", user.id)
    .maybeSingle();

  const params = await searchParams;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Settings
      </h1>

      <div className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Email
          </span>
          <span className="text-sm text-zinc-900 dark:text-zinc-50">
            {email}
          </span>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Plan
          </span>
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {plan}
          </span>
        </div>
      </div>

      {/* The tab bar holds four destinations; everything else it doesn't
          have room for is reachable from here. Hidden on desktop, where
          the sidebar already lists all of it. */}
      <nav className="mt-6 flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white md:hidden dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {MOBILE_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-14 items-center justify-between gap-3 px-5 py-3"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {link.label}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {link.description}
              </span>
            </span>
            <span aria-hidden className="text-zinc-400">
              ›
            </span>
          </Link>
        ))}
      </nav>

      <XConnectionForm
        initial={{
          handle: xConnection?.x_handle ?? null,
          provider: xConnection?.auth_provider === "oauth2" ? "oauth2" : "cookie",
        }}
        oauthConfigured={xOAuthConfigured()}
        legacyAvailable={Boolean(process.env.GETX_API_KEY)}
        callbackHandle={readParam(params, "x_connected")}
        callbackError={readParam(params, "x_error")}
      />

      <LogoutButton className="mt-6 inline-flex items-center justify-center rounded-full border border-zinc-300 px-6 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" />
    </div>
  );
}
