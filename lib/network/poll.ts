import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMockUserTweets,
  fetchUserTweets,
  type NetworkTweet,
  type UserTweetsPage,
} from "@/lib/getx/userTweets";
import { isFresh, syncTweets, STACK_WINDOW, type NetworkProfileRow } from "@/lib/network/stack";

export type PollOutcome =
  | { status: "skipped" } // still inside the TTL, nothing was fetched
  | { status: "polled"; synced: number }
  | { status: "failed"; message: string };

// GetXAPI returns a page of everything the account posted, replies and
// retweets included, and only the originals survive mapping. A person who
// mostly replies can therefore yield two or three cards from a page that
// was never short of posts — so when a page comes back under the window
// and says it has more, take one more page. One, not a loop: the second
// page is worth a call, an account that needs five is telling us it has
// nothing to stack.
async function fetchWindow(handle: string): Promise<UserTweetsPage> {
  const first = await fetchUserTweets(handle);
  if (first.tweets.length >= STACK_WINDOW || !first.hasMore) return first;

  const second = await fetchUserTweets(handle, first.nextCursor);
  const tweets: NetworkTweet[] = [...first.tweets, ...second.tweets];

  return {
    profile: first.profile ?? second.profile,
    tweets,
    nextCursor: second.nextCursor,
    hasMore: second.hasMore,
  };
}

// Polls one watched account and writes the result back: the newest posts
// into its stack, and the profile card details (which change on their own
// schedule — someone renames themselves, gains followers) onto the row.
//
// Never throws. One unreachable account must not blank the board, so the
// reason lands in last_error, which the stack header shows.
export async function pollProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: NetworkProfileRow,
  options: { force?: boolean } = {},
): Promise<PollOutcome> {
  if (!options.force && isFresh(profile)) return { status: "skipped" };

  const polledAt = new Date().toISOString();

  try {
    const page = process.env.GETX_API_KEY
      ? await fetchWindow(profile.handle)
      : buildMockUserTweets(profile.handle);

    const synced = await syncTweets(supabase, userId, profile.id, page.tweets);

    await supabase
      .from("network_profiles")
      .update({
        display_name: page.profile?.displayName ?? profile.display_name,
        avatar_url: page.profile?.avatarUrl ?? profile.avatar_url,
        bio: page.profile?.bio ?? profile.bio,
        followers_count: page.profile?.followersCount ?? profile.followers_count,
        last_polled_at: polledAt,
        last_error: null,
      })
      .eq("id", profile.id)
      .eq("user_id", userId);

    return { status: "polled", synced };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Couldn't load posts: ${error.message}`
        : "Couldn't load this account's posts.";
    console.error(`network poll failed for @${profile.handle}`, error);

    // last_polled_at is stamped on failure too, so the TTL throttles a
    // handle that is suspended or renamed instead of re-requesting it on
    // every page load. Refresh still forces past it.
    await supabase
      .from("network_profiles")
      .update({ last_polled_at: polledAt, last_error: message })
      .eq("id", profile.id)
      .eq("user_id", userId);

    return { status: "failed", message };
  }
}

// Polls a set of accounts, a few at a time. Sequential was fine at twelve
// monitored accounts; at twenty-five it is twenty-five round trips on the
// critical path of a page load, and unbounded parallelism is how you get
// rate-limited by GetXAPI. Four at a time is the compromise.
const POLL_CONCURRENCY = 4;

export async function pollProfiles(
  supabase: SupabaseClient,
  userId: string,
  profiles: NetworkProfileRow[],
  options: { force?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < profiles.length; i += POLL_CONCURRENCY) {
    const batch = profiles.slice(i, i + POLL_CONCURRENCY);
    await Promise.all(
      batch.map((profile) => pollProfile(supabase, userId, profile, options)),
    );
  }
}
