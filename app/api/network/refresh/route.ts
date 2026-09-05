import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pollProfiles } from "@/lib/network/poll";
import {
  flattenStacks,
  loadStacks,
  type NetworkProfileRow,
} from "@/lib/network/stack";

// Re-polls watched accounts and returns the rebuilt stacks. This is the
// only thing that fills a stack: Network is poll-only, so a stack changes
// when someone is looking at it and at no other time.
//
// Called on page load without `force`, which leaves accounts polled inside
// the TTL alone, and by the Refresh button with `force: true`, which polls
// every one of them.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const force =
    body && typeof body === "object" && (body as { force?: unknown }).force === true;

  const { data: profiles, error: profilesError } = await supabase
    .from("network_profiles")
    .select("*")
    .eq("user_id", user.id);

  if (profilesError) {
    console.error("network/refresh load failed", profilesError);
    return NextResponse.json({ error: "Failed to refresh Network." }, { status: 500 });
  }

  await pollProfiles(supabase, user.id, (profiles ?? []) as NetworkProfileRow[], { force });

  // Both shapes of the same rows: `stacks` for the desktop board, `feed`
  // for the phone's single stream. Derived in memory from one read, so
  // serving both costs nothing over serving either.
  const stacks = await loadStacks(supabase, user.id);
  return NextResponse.json({ stacks, feed: flattenStacks(stacks) });
}
