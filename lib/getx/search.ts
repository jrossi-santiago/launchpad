import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { FetchedTweet, TweetMetrics } from "@/lib/getx/tweet";

export type RadarResult = FetchedTweet & {
  alreadySaved: boolean;
  whyItMatched: string;
};

export type RadarSearchParams = {
  query: string;
  minFaves: number;
  rangeHours: number; // 24 | 72 | 168
  product: "Top" | "Latest";
  cursor: string; // "" for page one, never null/undefined
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

// Advanced-search query operators embedded by buildSearchQuery() (e.g.
// "min_faves:20", "since_time:1700000000") — stripped out before we look
// for literal keyword overlap with a result's content.
const OPERATOR_TOKEN_PATTERN = /\b[a-z_]+:\S+/gi;

// Cheap, deterministic, non-AI heuristic: strip operator tokens out of the
// query, then report which of the remaining words literally appear
// (case-insensitive substring match) in the result's content. GetXAPI's
// own relevance ranking can match on things not literally in the query, so
// this falls back to a generic line rather than claiming a false overlap.
export function buildWhyItMatched(content: string, query: string): string {
  const withoutOperators = query.replace(OPERATOR_TOKEN_PATTERN, " ");
  const words = Array.from(
    new Set(
      withoutOperators
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 1),
    ),
  );

  const lowerContent = content.toLowerCase();
  const matched = words.filter((word) => lowerContent.includes(word.toLowerCase()));

  if (matched.length === 0) {
    return "High-engagement match in your search";
  }

  return `Matches ${matched.map((word) => `"${word}"`).join(", ")} from your search`;
}

// Response shape verified against the live API (see the flat-envelope note
// below) — every shape assumption lives only in this function so a wrong
// guess is a one-function fix.
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

  // Unlike tweet/detail, advanced_search is NOT wrapped in a
  // { status, msg, data } envelope — it's a flat
  // { query, tweet_count, has_more, next_cursor, tweets: [...] } object.
  // Verified against the live API. An empty `tweets` array is a valid
  // "no matches" response, not an error.
  const tweets = Array.isArray(envelope.tweets) ? envelope.tweets : [];

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
    typeof envelope.next_cursor === "string" ? envelope.next_cursor : null;

  return { results, nextCursor };
}

export async function fetchTweetSearch(params: RadarSearchParams): Promise<{
  results: FetchedTweet[];
  nextCursor: string | null;
}> {
  const baseUrl = process.env.GETX_API_BASE_URL ?? "https://api.getxapi.com";
  const query = buildSearchQuery(params);
  const cursorParam = params.cursor
    ? `&cursor=${encodeURIComponent(params.cursor)}`
    : "";
  const response = await fetch(
    `${baseUrl}/twitter/tweet/advanced_search?q=${encodeURIComponent(query)}&product=${params.product}${cursorParam}`,
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

// Deterministic sentinel returned as page 1's nextCursor so "More" is
// testable end-to-end with no GETX_API_KEY set (per Lesson 4/Day 6 goal).
export const MOCK_NEXT_CURSOR = "mock-page-2";

function buildMockPage(
  params: RadarSearchParams,
  pageOffset: number,
): FetchedTweet[] {
  const count = 15;
  return Array.from({ length: count }, (_, i) => {
    const n = pageOffset + i;
    const id = `800000000000000${String(1000 + n).slice(1)}`;
    const handle = MOCK_HANDLES[n % MOCK_HANDLES.length];
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
      content: `[Mock result ${n + 1}] Matching "${params.query}" — set GETX_API_KEY to search real X posts here.`,
      url: `https://x.com/${handle}/status/${id}`,
      metrics,
      engagement_score: likeCount + retweetCount + replyCount,
    };
  });
}

export function buildMockSearchResults(params: RadarSearchParams): {
  results: FetchedTweet[];
  nextCursor: string | null;
} {
  if (params.cursor === MOCK_NEXT_CURSOR) {
    return { results: buildMockPage(params, 15), nextCursor: null };
  }

  return { results: buildMockPage(params, 0), nextCursor: MOCK_NEXT_CURSOR };
}
