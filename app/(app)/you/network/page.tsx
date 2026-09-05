import { createClient } from "@/lib/supabase/server";
import { loadStacks, MAX_PROFILES } from "@/lib/network/stack";
import { NetworkBoard } from "@/components/network/NetworkBoard";

// Supabase surfaces Postgres and PostgREST failures as a plain object with
// message/code/hint rather than an Error, so both shapes are unwrapped.
function describeError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error.";

  const e = error as { message?: unknown; code?: unknown; hint?: unknown };
  const message =
    typeof e.message === "string" && e.message ? e.message : "unknown error";
  const code = typeof e.code === "string" && e.code ? ` [${e.code}]` : "";
  const hint = typeof e.hint === "string" && e.hint ? ` ${e.hint}` : "";

  return `${message}${code}.${hint}`;
}

export default async function NetworkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The (app) layout already redirects unauthenticated visitors to /login.
    return null;
  }

  // Renders whatever is already stored so the board is never blank on
  // arrival; the board then re-polls once on load to top the stacks up.
  //
  // A failed read must not take the tab down with it: a server component
  // that throws renders the framework's blank 500 page — no page, no
  // message, nothing to act on. So the failure becomes a banner over an
  // empty board instead.
  //
  // The banner carries the database's own words. A guess at the cause
  // ("check your migrations") is worth very little when the real answer is
  // a stale PostgREST schema cache or an app pointed at a different
  // project, and those are distinguishable only by the error code the
  // server already has in hand.
  const result = await loadStacks(supabase, user.id).then(
    (stacks) => ({ stacks, error: null as unknown }),
    (error: unknown) => ({ stacks: [], error }),
  );

  if (result.error) console.error("network page load failed", result.error);

  const loadError = result.error
    ? `Couldn't load your Network — ${describeError(result.error)}`
    : null;

  return (
    <NetworkBoard
      initialStacks={result.stacks}
      maxProfiles={MAX_PROFILES}
      initialError={loadError}
    />
  );
}
