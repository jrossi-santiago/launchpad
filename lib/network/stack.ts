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
  // Written by a Feed Reload: one reply Haiku wrote for this post
  // specifically. Null on a card that has never been through one — and
  // also on one that was read and declined, which reply_unclear tells
  // apart.
  suggested_reply: string | null;
  suggested_reply_at: string | null;
  // What the model made of the post, and what it could not tell from what
  // it was given. reply_unclear with no reply is a decline.
  reply_about: string | null;
  reply_unclear: string | null;
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
      "id, profile_id, x_tweet_id, content, url, metrics, engagement_score, posted_at, source, quoted, suggested_reply, suggested_reply_at, reply_about, reply_unclear",
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
      suggested_reply:
        typeof row.suggested_reply === "string" ? row.suggested_reply : null,
      suggested_reply_at:
        typeof row.suggested_reply_at === "string" ? row.suggested_reply_at : null,
      reply_about: typeof row.reply_about === "string" ? row.reply_about : null,
      reply_unclear:
        typeof row.reply_unclear === "string" ? row.reply_unclear : null,
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

// One card, carrying the account it came from — what a per-profile stack
// leaves implicit in its column header, and what a single mixed stream has
// to say on every card.
export type FeedCard = NetworkCard & {
  profile_id: string;
  handle: string;
  display_name: string | null;
};

// A phone has no room for one column per account, so the Feed is the same
// cards in one stream: replies first, then chronological. Derived from
// the stacks rather than queried separately — same rows, same window,
// same already-decided filtering, no second trip to the database.
//
// The per-stack STACK_WINDOW slice still applies first, so one very
// prolific account can contribute at most its window to the stream.
// Cards carrying a written reply first, then everything else, each half
// newest first.
//
// A reply exists because the model read the post and had something to say
// about it, and a decline exists because it read the post and did not —
// so "has a reply" is the closest thing the Feed has to a relevance
// signal, and it costs nothing to sort on. Putting those at the top means
// the work Reload just paid for is the first thing under your thumb,
// instead of scattered through the stream by timestamp.
//
// Underneath, both halves stay chronological. The second half is not
// ranked, demoted or hidden — a post with no reply is still a post you
// might want, and the only thing being said about it is that nobody has
// written anything for it yet.
function byReplyThenNewest(a: NetworkCard, b: NetworkCard): number {
  const left = a.suggested_reply ? 1 : 0;
  const right = b.suggested_reply ? 1 : 0;
  if (left !== right) return right - left;
  return byNewest(a, b);
}

// The same order, applied to cards that are already flat. A sweep writes
// replies after its stacks were loaded, so the rows it hands back are one
// step ahead of the database it read — sorting the stale copy would put
// the replies it just wrote in the order they were missing.
export function sortFeed(cards: FeedCard[]): FeedCard[] {
  return [...cards].sort(byReplyThenNewest);
}

export function flattenStacks(stacks: NetworkStack[]): FeedCard[] {
  return stacks
    .flatMap((stack) =>
      stack.cards.map((card) => ({
        ...card,
        profile_id: stack.profile.id,
        handle: stack.profile.handle,
        display_name: stack.profile.display_name,
      })),
    )
    .sort(byReplyThenNewest);
}
