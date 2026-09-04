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
  const stacks = await loadStacks(supabase, user.id);

  return <NetworkBoard initialStacks={stacks} maxProfiles={MAX_PROFILES} />;
}
