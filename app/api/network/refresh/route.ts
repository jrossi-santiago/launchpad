import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMockUserTweets, fetchUserTweets } from "@/lib/getx/userTweets";
import { ingestTweets, loadStacks, STACK_LIMIT, type NetworkProfileRow } from "@/lib/network/stack";

// Re-polls every watched account and returns the rebuilt stacks. Called
// once when the Network page loads and again when the user clicks Refresh
// — there is no background timer, so a stack only ever changes when
// someone is looking at it (or when a monitor pushes a post).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("network_profiles")
    .select("*")
    .eq("user_id", user.id);

  if (profilesError) {
    console.error("network/refresh load failed", profilesError);
    return NextResponse.json({ error: "Failed to refresh Network." }, { status: 500 });
  }

  const rows = (profiles ?? []) as NetworkProfileRow[];

  // Sequential on purpose: GetXAPI rate-limits per account, and a dozen
  // profiles is a fraction of a second each.
  for (const profile of rows) {
    try {
      const page = process.env.GETX_API_KEY
        ? await fetchUserTweets(profile.handle)
        : buildMockUserTweets(profile.handle);

      await ingestTweets(
        supabase,
        user.id,
        profile.id,
        page.tweets.slice(0, STACK_LIMIT),
        "poll",
      );

      await supabase
        .from("network_profiles")
        .update({
          display_name: page.profile?.displayName ?? profile.display_name,
          avatar_url: page.profile?.avatarUrl ?? profile.avatar_url,
          bio: page.profile?.bio ?? profile.bio,
          followers_count: page.profile?.followersCount ?? profile.followers_count,
          last_polled_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
    } catch (error) {
      // One unreachable account must not blank the whole board.
      console.error(`network/refresh failed for @${profile.handle}`, error);
    }
  }

  const stacks = await loadStacks(supabase, user.id);
  return NextResponse.json({ stacks });
}
