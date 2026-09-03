import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { FetchedTweet, TweetMetrics } from "@/lib/getx/tweet";

export type RadarResult = FetchedTweet & { alreadySaved: boolean };

export type RadarSearchParams = {
  query: string;
  minFaves: number;
  rangeHours: number; // 24 | 72 | 168
};

// Takes the first line of `icp` (falling back to `business_summary` if icp
// is empty), trimmed to roughly the first 8 words, with trailing punctuation
// stripped. This just needs to be a reasonable, non-empty starting point —
// the query box is editable, so a smarter extraction can replace this later
// without touching callers.
export function buildDefaultRadarQuery(brandPack: BrandPackRow): string {
  const source = (brandPack.icp?.split("\n")[0] || brandPack.business_summary || "").trim();
  const words = source.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.join(" ").replace(/[.,;:!?]+$/, "");
}

// Appends "min_faves:<n>" and a since_time:<unix seconds> operator to
// params.query. This exact operator syntax is part of the unverified
// GetXAPI advanced-search contract (see AGENTS.md caveat) — confirm against
// the live API if a key is available before trusting it further.
export function buildSearchQuery(params: RadarSearchParams): string {
  const sinceSeconds = Math.floor(Date.now() / 1000 - params.rangeHours * 3600);
  return `${params.query} min_faves:${params.minFaves} since_time:${sinceSeconds}`;
}

// GetXAPI wraps the search response the same way as tweet/detail: an
// envelope `{ status, msg, data }`. The advanced-search endpoint has NOT
// been verified against the live API the way tweet/detail was — every
// shape assumption below lives only in this function so a wrong guess is a
// one-function fix.
export function mapGetXSearchResponseToResults(response: unknown): {
  results: FetchedTweet[];
  nextCursor: string | null;
} {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI response was not a valid object.");
  }

  const envelope = response as Record<string, unknown>;
  if (typeof envelope.error === "string") {
    throw new Error(`GetXAPI returned an error: ${envelope.error}`);
  }

  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  if (!data) {
    throw new Error("GetXAPI response did not include a data object.");
  }

  const tweets = Array.isArray(data.tweets) ? data.tweets : [];

  const results: FetchedTweet[] = tweets.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("GetXAPI search result item was not a valid object.");
    }

    const item = raw as Record<string, unknown>;
    const author =
      item.author && typeof item.author === "object"
        ? (item.author as Record<string, unknown>)
        : null;

    const id = item.id;
    const text = item.text;
    const userName = author?.userName;
    const likeCount = item.likeCount;
    const retweetCount = item.retweetCount;
    const replyCount = item.replyCount;

    if (
      typeof id !== "string" ||
      typeof text !== "string" ||
      typeof userName !== "string" ||
      typeof likeCount !== "number" ||
      typeof retweetCount !== "number" ||
      typeof replyCount !== "number"
    ) {
      throw new Error(
        "GetXAPI search result did not include the expected tweet fields.",
      );
    }

    const metrics: TweetMetrics = {
      like_count: likeCount,
      retweet_count: retweetCount,
      reply_count: replyCount,
    };

    return {
      x_tweet_id: id,
      author_handle: `@${userName}`,
      content: text,
      url:
        typeof item.url === "string"
          ? item.url
          : `https://x.com/${userName}/status/${id}`,
      metrics,
      engagement_score: likeCount + retweetCount + replyCount,
    };
  });

  const nextCursor =
    typeof data.next_cursor === "string"
      ? data.next_cursor
      : typeof data.nextCursor === "string"
        ? data.nextCursor
        : null;

  return { results, nextCursor };
}

export async function fetchTweetSearch(params: RadarSearchParams): Promise<{
  results: FetchedTweet[];
  nextCursor: string | null;
}> {
  const baseUrl = process.env.GETX_API_BASE_URL ?? "https://api.getxapi.com";
  const query = buildSearchQuery(params);
  const response = await fetch(
    `${baseUrl}/twitter/tweet/advanced_search?query=${encodeURIComponent(query)}&product=Top`,
    {
      headers: {
        authorization: `Bearer ${process.env.GETX_API_KEY!}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GetXAPI responded with ${response.status}: ${body}`);
  }

  const data = await response.json();
  return mapGetXSearchResponseToResults(data);
}

const MOCK_HANDLES = [
  "buildinpublic_dev",
  "saasfounder",
  "growth_gina",
  "indiehacks",
  "b2b_marketer",
  "productmuse",
  "foundercoach",
  "launch_lena",
  "revops_ray",
  "startup_signal",
];

export function buildMockSearchResults(params: RadarSearchParams): {
  results: FetchedTweet[];
  nextCursor: string | null;
} {
  const count = 15;
  const results: FetchedTweet[] = Array.from({ length: count }, (_, i) => {
    const id = `800000000000000${String(1000 + i).slice(1)}`;
    const handle = MOCK_HANDLES[i % MOCK_HANDLES.length];
    const likeCount = params.minFaves + (count - i) * 7;
    const retweetCount = Math.floor(likeCount / 4);
    const replyCount = Math.floor(likeCount / 8);

    const metrics: TweetMetrics = {
      like_count: likeCount,
      retweet_count: retweetCount,
      reply_count: replyCount,
    };

    return {
      x_tweet_id: id,
      author_handle: `@${handle}`,
      content: `[Mock result ${i + 1}] Matching "${params.query}" — set GETX_API_KEY to search real X posts here.`,
      url: `https://x.com/${handle}/status/${id}`,
      metrics,
      engagement_score: likeCount + retweetCount + replyCount,
    };
  });

  return { results, nextCursor: null };
}
