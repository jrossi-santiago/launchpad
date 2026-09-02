import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <span className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        Launchpad
      </span>
      <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Find your next customers on X, before your competitors do.
      </h1>
      <p className="mt-4 max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Launchpad helps founders spot high-engagement conversations, jump in
        with a great reply, and turn that into warm leads.
      </p>
      <Link
        href="/login"
        className="mt-8 inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Get started
      </Link>
    </div>
  );
}
