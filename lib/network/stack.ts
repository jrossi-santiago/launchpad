import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetworkTweet } from "@/lib/getx/userTweets";
import type { TweetMetrics } from "@/lib/getx/tweet";

// How many cards a stack shows. The face-up card plus the fanned ones
// underneath it — more than this and the fan stops being readable.
export const STACK_LIMIT = 8;

// Every watched account holds a GetXAPI monitoring plan slot, so the cap
// is deliberate rather than cosmetic.
export const MAX_PROFILES = 12;

export type NetworkProfileRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number | null;
  monitor_id: string | null;
  monitor_status: "none" | "active" | "paused";
  monitor_error: string | null;
  last_polled_at: string | null;
  created_at: string;
};

export type NetworkCard = {
  id: string;
  x_tweet_id: string;
  content: string | null;
  url: string | null;
  metrics: TweetMetrics;
  engagement_score: number | null;
  posted_at: string | null;
  source: string;
};

export type NetworkStack = {
  profile: NetworkProfileRow;
  cards: NetworkCard[];
};

const EMPTY_METRICS: TweetMetrics = {
  like_count: 0,
  retweet_count: 0,
  reply_count: 0,
};

function toMetrics(value: unknown): TweetMetrics {
  if (!value || typeof value !== "object") return EMPTY_METRICS;
  const m = value as Record<string, unknown>;
  return {
    like_count: typeof m.like_count === "number" ? m.like_count : 0,
    retweet_count: typeof m.retweet_count === "number" ? m.retweet_count : 0,
    reply_count: typeof m.reply_count === "number" ? m.reply_count : 0,
  };
}

// Newest first, with cards that have no usable posted_at sorted last
// rather than jumping to the top of the stack.
function byNewest(a: NetworkCard, b: NetworkCard): number {
  const left = a.posted_at ? Date.parse(a.posted_at) : 0;
  const right = b.posted_at ? Date.parse(b.posted_at) : 0;
  return right - left;
}

// One query for profiles and one for their undecided cards, grouped in
// memory — cheap at a dozen profiles, and it keeps the per-stack limit in
// one place instead of issuing a query per stack.
export async function loadStacks(
  supabase: SupabaseClient,
  userId: string,
): Promise<NetworkStack[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from("network_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (profilesError) throw profilesError;
  const profileRows = (profiles ?? []) as NetworkProfileRow[];
  if (profileRows.length === 0) return [];

  const { data: tweets, error: tweetsError } = await supabase
    .from("network_tweets")
    .select("id, profile_id, x_tweet_id, content, url, metrics, engagement_score, posted_at, source")
    .eq("user_id", userId)
    .eq("state", "new");

  if (tweetsError) throw tweetsError;

  const byProfile = new Map<string, NetworkCard[]>();
  for (const raw of tweets ?? []) {
    const row = raw as Record<string, unknown>;
    const profileId = String(row.profile_id);
    const card: NetworkCard = {
      id: String(row.id),
      x_tweet_id: String(row.x_tweet_id),
      content: typeof row.content === "string" ? row.content : null,
      url: typeof row.url === "string" ? row.url : null,
      metrics: toMetrics(row.metrics),
      engagement_score:
        typeof row.engagement_score === "number" ? row.engagement_score : null,
      posted_at: typeof row.posted_at === "string" ? row.posted_at : null,
      source: typeof row.source === "string" ? row.source : "poll",
    };
    const existing = byProfile.get(profileId);
    if (existing) existing.push(card);
    else byProfile.set(profileId, [card]);
  }

  return profileRows.map((profile) => ({
    profile,
    cards: (byProfile.get(profile.id) ?? []).sort(byNewest).slice(0, STACK_LIMIT),
  }));
}

// Inserts only posts this user has never seen before. The dedupe read is
// on (user_id, x_tweet_id) across every state, so a post the user already
// sent or skipped is never re-added by a later poll or a monitor delivery
// that overlaps it.
export async function ingestTweets(
  supabase: SupabaseClient,
  userId: string,
  profileId: string,
  tweets: NetworkTweet[],
  source: "poll" | "monitor",
): Promise<number> {
  if (tweets.length === 0) return 0;

  const ids = tweets.map((tweet) => tweet.x_tweet_id);
  const { data: existing, error: existingError } = await supabase
    .from("network_tweets")
    .select("x_tweet_id")
    .eq("user_id", userId)
    .in("x_tweet_id", ids);

  if (existingError) throw existingError;

  const seen = new Set(
    (existing ?? []).map((row) => String((row as { x_tweet_id: string }).x_tweet_id)),
  );
  const fresh = tweets.filter((tweet) => !seen.has(tweet.x_tweet_id));
  if (fresh.length === 0) return 0;

  const { error: insertError } = await supabase.from("network_tweets").insert(
    fresh.map((tweet) => ({
      user_id: userId,
      profile_id: profileId,
      x_tweet_id: tweet.x_tweet_id,
      content: tweet.content,
      url: tweet.url,
      metrics: tweet.metrics,
      engagement_score: tweet.engagement_score,
      posted_at: tweet.posted_at,
      source,
    })),
  );

  if (insertError) throw insertError;
  return fresh.length;
}
