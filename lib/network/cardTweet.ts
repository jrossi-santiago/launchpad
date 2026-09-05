import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchedTweet, TweetMetrics } from "@/lib/getx/tweet";

// A Network card and a Radar result describe the same thing in two shapes.
// Everything that puts a card into the `tweets` table — sending it to the
// Launchpad queue, liking it straight from the Feed — needs the same
// translation, so it lives here once rather than in each route.

export type NetworkCardRow = {
  id: string;
  x_tweet_id: string;
  content: string | null;
  url: string | null;
  metrics: unknown;
  engagement_score: number | null;
  state: string;
  network_profiles: { handle: string } | { handle: string }[] | null;
};

const CARD_COLUMNS =
  "id, x_tweet_id, content, url, metrics, engagement_score, state, network_profiles(handle)";

function toMetrics(value: unknown): TweetMetrics {
  if (!value || typeof value !== "object") {
    return { like_count: 0, retweet_count: 0, reply_count: 0 };
  }
  const m = value as Record<string, unknown>;
  return {
    like_count: typeof m.like_count === "number" ? m.like_count : 0,
    retweet_count: typeof m.retweet_count === "number" ? m.retweet_count : 0,
    reply_count: typeof m.reply_count === "number" ? m.reply_count : 0,
  };
}

// PostgREST types an embedded one-to-one join as either an object or an
// array depending on how it infers the relationship, so both are handled.
function handleOf(row: NetworkCardRow): string | null {
  const joined = Array.isArray(row.network_profiles)
    ? row.network_profiles[0]
    : row.network_profiles;
  return joined?.handle ?? null;
}

export function cardToFetchedTweet(row: NetworkCardRow): FetchedTweet {
  const handle = handleOf(row);
  return {
    x_tweet_id: row.x_tweet_id,
    author_handle: handle ? `@${handle}` : "@unknown",
    content: row.content ?? "",
    url: row.url ?? `https://x.com/i/status/${row.x_tweet_id}`,
    metrics: toMetrics(row.metrics),
    engagement_score: row.engagement_score ?? 0,
  };
}

// Returns null when the card isn't this user's — callers turn that into a
// 404, and RLS would refuse the row anyway.
export async function loadCard(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
): Promise<NetworkCardRow | null> {
  const { data, error } = await supabase
    .from("network_tweets")
    .select(CARD_COLUMNS)
    .eq("user_id", userId)
    .eq("id", cardId)
    .maybeSingle();

  if (error) throw error;
  return (data as NetworkCardRow | null) ?? null;
}
