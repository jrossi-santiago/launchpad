import type { createClient } from "@/lib/supabase/server";

export type TweetMetrics = {
  like_count: number;
  retweet_count: number;
  reply_count: number;
};

export type TweetRow = {
  id: string;
  user_id: string;
  x_tweet_id: string;
  author_handle: string | null;
  content: string | null;
  url: string | null;
  metrics: TweetMetrics;
  engagement_score: number | null;
  status: string;
  created_at: string;
};

export type FetchedTweet = {
  x_tweet_id: string;
  author_handle: string;
  content: string;
  url: string;
  metrics: TweetMetrics;
  engagement_score: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export function parseStatusId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (!/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return null;
    const match = url.pathname.match(/\/status(?:es)?\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function mapGetXResponseToTweetRow(data: unknown): FetchedTweet {
  if (!data || typeof data !== "object") {
    throw new Error("GetXAPI response was not a valid object.");
  }

  const value = data as Record<string, unknown>;
  const user =
    value.user && typeof value.user === "object"
      ? (value.user as Record<string, unknown>)
      : null;

  const idStr = value.id_str;
  const fullText = value.full_text;
  const screenName = user?.screen_name;
  const favoriteCount = value.favorite_count;
  const retweetCount = value.retweet_count;
  const replyCount = value.reply_count;

  if (
    typeof idStr !== "string" ||
    typeof fullText !== "string" ||
    typeof screenName !== "string" ||
    typeof favoriteCount !== "number" ||
    typeof retweetCount !== "number" ||
    typeof replyCount !== "number"
  ) {
    throw new Error(
      "GetXAPI response did not include the expected tweet fields.",
    );
  }

  const metrics: TweetMetrics = {
    like_count: favoriteCount,
    retweet_count: retweetCount,
    reply_count: replyCount,
  };

  return {
    x_tweet_id: idStr,
    author_handle: `@${screenName}`,
    content: fullText,
    url: `https://x.com/${screenName}/status/${idStr}`,
    metrics,
    engagement_score: favoriteCount + retweetCount + replyCount,
  };
}

export async function fetchTweetDetail(id: string): Promise<FetchedTweet> {
  const response = await fetch(
    `${process.env.GETX_API_BASE_URL}/twitter/tweet/detail?tweet_id=${id}`,
    {
      headers: {
        "x-rapidapi-key": process.env.GETX_API_KEY!,
        "x-rapidapi-host": process.env.GETX_API_HOST!,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GetXAPI responded with ${response.status}: ${body}`);
  }

  const data = await response.json();
  return mapGetXResponseToTweetRow(data);
}

export function buildMockTweet(id: string): FetchedTweet {
  const metrics: TweetMetrics = {
    like_count: 120,
    retweet_count: 30,
    reply_count: 8,
  };

  return {
    x_tweet_id: id,
    author_handle: "@mock_founder",
    content: `[Mock tweet ${id}] Set GETX_API_KEY to fetch the real tweet text and metrics here.`,
    url: `https://x.com/mock_founder/status/${id}`,
    metrics,
    engagement_score:
      metrics.like_count + metrics.retweet_count + metrics.reply_count,
  };
}

export async function upsertTweetRow(
  supabase: SupabaseServerClient,
  userId: string,
  fetched: FetchedTweet,
): Promise<TweetRow> {
  const { data: existing, error: lookupError } = await supabase
    .from("tweets")
    .select("id")
    .eq("user_id", userId)
    .eq("x_tweet_id", fetched.x_tweet_id)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const payload = {
    author_handle: fetched.author_handle,
    content: fetched.content,
    url: fetched.url,
    metrics: fetched.metrics,
    engagement_score: fetched.engagement_score,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("tweets")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return data as TweetRow;
  }

  const { data, error } = await supabase
    .from("tweets")
    .insert({ user_id: userId, x_tweet_id: fetched.x_tweet_id, ...payload })
    .select()
    .single();

  if (error) throw error;
  return data as TweetRow;
}
