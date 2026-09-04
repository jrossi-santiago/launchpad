import { createClient } from "@/lib/supabase/server";
import { loadStacks, MAX_PROFILES } from "@/lib/network/stack";
import { NetworkBoard } from "@/components/network/NetworkBoard";

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
  // A failed read must not take the tab down with it. The commonest cause
  // is a project whose Network migrations have not been pushed, and a
  // server component that throws there renders the framework's blank 500
  // page — no page, no message, nothing to act on. So the failure becomes
  // a banner over an empty board instead.
  let stacks = await loadStacks(supabase, user.id).catch((error: unknown) => {
    console.error("network page load failed", error);
    return null;
  });

  const loadError =
    stacks === null
      ? "Couldn't load your Network. If this project's database is new, check that the Network migrations (supabase/migrations/0012 and 0014) have been pushed."
      : null;

  stacks ??= [];

  return (
    <NetworkBoard
      initialStacks={stacks}
      maxProfiles={MAX_PROFILES}
      initialError={loadError}
    />
  );
}
