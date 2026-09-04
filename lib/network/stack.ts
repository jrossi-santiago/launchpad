import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetworkTweet, QuotedPost } from "@/lib/getx/userTweets";
import type { TweetMetrics } from "@/lib/getx/tweet";

// Network is a rolling window, not an inbox: one poll of
// GET /twitter/user/tweets keeps the newest posts per account, and a stack
// shows that window minus whatever you have already sent or skipped.
export const STACK_WINDOW = 10;

// Nothing scarce is consumed per account any more — the old cap was one
// GetXAPI monitor slot each — so the limit is a call budget: one request
// per account per poll, and this is how many a Refresh can cost.
export const MAX_PROFILES = 25;

// A page load re-polls, so bouncing in and out of Network would otherwise
// spend the whole budget for nothing. An account polled inside this window
// is left alone; the Refresh button sends force and ignores it.
export const POLL_TTL_MS = 3 * 60 * 1000;

export type NetworkProfileRow = {
  id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number | null;
  last_error: string | null;
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
  quoted: QuotedPost | null;
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

// The column is jsonb and its shape came from an undocumented API field,
// so it is validated on the way out as well as on the way in.
function toQuoted(value: unknown): QuotedPost | null {
  if (!value || typeof value !== "object") return null;
  const q = value as Record<string, unknown>;
  if (typeof q.handle !== "string" || typeof q.text !== "string") return null;
  return {
    handle: q.handle,
    name: typeof q.name === "string" ? q.name : null,
    text: q.text,
    url: typeof q.url === "string" ? q.url : null,
  };
}

// Newest first, with cards that have no usable posted_at sorted last
// rather than jumping to the top of the stack.
function byNewest(a: NetworkCard, b: NetworkCard): number {
  const left = a.posted_at ? Date.parse(a.posted_at) : 0;
  const right = b.posted_at ? Date.parse(b.posted_at) : 0;
  return right - left;
}

// True when this account was polled recently enough that polling it again
// would buy nothing. `force` (the Refresh button) skips the check.
export function isFresh(profile: NetworkProfileRow, now = Date.now()): boolean {
  if (!profile.last_polled_at) return false;
  const polled = Date.parse(profile.last_polled_at);
  if (Number.isNaN(polled)) return false;
  return now - polled < POLL_TTL_MS;
}

// One query for profiles and one for their undecided cards, grouped in
// memory — cheap at a couple of dozen profiles, and it keeps the per-stack
// window in one place instead of issuing a query per stack.
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
    .select(
      "id, profile_id, x_tweet_id, content, url, metrics, engagement_score, posted_at, source, quoted",
    )
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
      quoted: toQuoted(row.quoted),
    };
    const existing = byProfile.get(profileId);
    if (existing) existing.push(card);
    else byProfile.set(profileId, [card]);
  }

  return profileRows.map((profile) => ({
    profile,
    cards: (byProfile.get(profile.id) ?? []).sort(byNewest).slice(0, STACK_WINDOW),
  }));
}

// Writes one poll's window back.
//
// This is an upsert on (user_id, x_tweet_id) rather than an insert of
// what's new, which does two jobs at once: a post we have never seen is
// added, and a post we already hold has its metrics brought up to date —
// without which a card ingested at two likes would still read two likes
// hours later.
//
// `state` and `tweet_id` are deliberately absent from the payload, so
// on-conflict never touches them: a card the user already sent or skipped
// keeps that decision and stays off the stack, which is exactly what stops
// the next poll from resurrecting it.
export async function syncTweets(
  supabase: SupabaseClient,
  userId: string,
  profileId: string,
  tweets: NetworkTweet[],
): Promise<number> {
  const window = tweets.slice(0, STACK_WINDOW);
  if (window.length === 0) return 0;

  const { error } = await supabase.from("network_tweets").upsert(
    window.map((tweet) => ({
      user_id: userId,
      profile_id: profileId,
      x_tweet_id: tweet.x_tweet_id,
      content: tweet.content,
      url: tweet.url,
      metrics: tweet.metrics,
      engagement_score: tweet.engagement_score,
      posted_at: tweet.posted_at,
      source: "poll",
      quoted: tweet.quoted,
    })),
    { onConflict: "user_id,x_tweet_id" },
  );

  if (error) throw error;
  return window.length;
}
