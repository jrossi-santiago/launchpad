import { authHeaders, extractErrorMessage, getBaseUrl, readBody } from "@/lib/getx/client";
import type { FetchedTweet, TweetMetrics } from "@/lib/getx/tweet";

// A tweet as it appears in a Network stack: everything the Launchpad queue
// needs (FetchedTweet, so it can be handed straight to upsertTweetRow)
// plus when it was posted, which is what orders a stack.
export type NetworkTweet = FetchedTweet & {
  posted_at: string | null; // ISO-8601, null when GetXAPI's date is unparseable
  quoted: QuotedPost | null; // the post this one quotes, when it quotes one
};

// Just enough of a quoted post to show what is being reacted to. Not a
// NetworkTweet: a quote's quote is not something a card needs, and metrics
// on a post we are not triaging would only add noise.
export type QuotedPost = {
  handle: string;
  name: string | null;
  text: string;
  url: string | null;
};

export type NetworkProfileInfo = {
  handle: string; // bare, no leading "@"
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number | null;
};

export type UserTweetsPage = {
  profile: NetworkProfileInfo | null;
  tweets: NetworkTweet[];
  // Paging exists for one reason: a page of a reply-heavy account can hold
  // only a handful of original posts, and a stack of three cards from
  // someone who posts daily is a bug, not a quiet week.
  nextCursor: string | null;
  hasMore: boolean;
};

// Accepts "@handle", "handle", or any x.com/twitter.com profile URL, and
// returns the bare handle. X handles are 1-15 word characters.
export function parseHandle(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return null;
      candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return null;
    }
  }

  candidate = candidate.replace(/^@/, "");
  return /^\w{1,15}$/.test(candidate) ? candidate : null;
}

// GetXAPI returns "Tue Jan 13 12:56:12 +0000 2026" (Twitter's own format),
// which Date can parse. Anything unparseable becomes null rather than an
// Invalid Date that would poison the sort.
function parseCreatedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Retweets have no dedicated boolean in the response, so they are detected
// the same way every X client does it: the text starts with "RT @handle:".
function isRetweetText(text: string): boolean {
  return /^RT @\w{1,15}:/.test(text);
}

// Network deliberately carries a person's own original posts only — no
// replies, no retweets. A stack of "@someone lol agreed" is not something
// you would reply to, and a retweet is somebody else's post.
export function isOwnOriginalPost(item: Record<string, unknown>): boolean {
  if (item.isReply === true) return false;
  if (typeof item.inReplyToId === "string" && item.inReplyToId) return false;
  if (typeof item.text === "string" && isRetweetText(item.text)) return false;
  if (typeof item.retweeted_tweet === "object" && item.retweeted_tweet) return false;
  return true;
}

// Maps one raw tweet object. Shared by the poll mapper below and by the
// webhook mapper, which receives the same tweet shape. Returns null for
// anything that is not a usable original post, so a single odd item in a
// page never fails the whole fetch.
export function mapRawTweet(raw: unknown): NetworkTweet | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  if (!isOwnOriginalPost(item)) return null;

  const author =
    item.author && typeof item.author === "object"
      ? (item.author as Record<string, unknown>)
      : null;

  const id = typeof item.id === "string" ? item.id : null;
  const text = typeof item.text === "string" ? item.text : null;
  const userName = typeof author?.userName === "string" ? author.userName : null;
  if (!id || text === null || !userName) return null;

  const metrics: TweetMetrics = {
    like_count: typeof item.likeCount === "number" ? item.likeCount : 0,
    retweet_count: typeof item.retweetCount === "number" ? item.retweetCount : 0,
    reply_count: typeof item.replyCount === "number" ? item.replyCount : 0,
  };

  return {
    x_tweet_id: id,
    author_handle: `@${userName}`,
    content: text,
    url: typeof item.url === "string" ? item.url : `https://x.com/${userName}/status/${id}`,
    metrics,
    engagement_score: metrics.like_count + metrics.retweet_count + metrics.reply_count,
    posted_at: parseCreatedAt(item.createdAt),
    quoted: mapQuotedTweet(item.quoted_tweet),
  };
}

// UNDOCUMENTED SHAPE — GetXAPI's spec shows `quoted_tweet` on a tweet but
// only ever as null, so its fields are read defensively: the nested object
// is assumed to look like a tweet (author.userName, text, url), with the
// handle also accepted at the top level in case it is flattened. Anything
// we cannot read a handle and text out of becomes null, which costs the
// card its context block and nothing else — the post itself still stacks.
export function mapQuotedTweet(raw: unknown): QuotedPost | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const author =
    item.author && typeof item.author === "object"
      ? (item.author as Record<string, unknown>)
      : null;

  const handleSource =
    (typeof author?.userName === "string" ? author.userName : null) ??
    (typeof item.userName === "string" ? item.userName : null);
  const text = typeof item.text === "string" ? item.text : null;
  if (!handleSource || !text) return null;

  const handle = handleSource.replace(/^@/, "");
  const id = typeof item.id === "string" ? item.id : null;

  return {
    handle,
    name: typeof author?.name === "string" ? author.name : null,
    text,
    url:
      typeof item.url === "string"
        ? item.url
        : id
          ? `https://x.com/${handle}/status/${id}`
          : null,
  };
}

function mapAuthorToProfile(raw: unknown): NetworkProfileInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const author = raw as Record<string, unknown>;
  const userName = author.userName;
  if (typeof userName !== "string" || !userName) return null;

  return {
    handle: userName.replace(/^@/, ""),
    displayName: typeof author.name === "string" ? author.name : null,
    avatarUrl: typeof author.profilePicture === "string" ? author.profilePicture : null,
    bio: typeof author.description === "string" ? author.description : null,
    followersCount: typeof author.followers === "number" ? author.followers : null,
  };
}

// CONTRACT — GET /twitter/user/tweets, from GetXAPI's published OpenAPI
// spec (https://docs.getxapi.com/openapi.json). Like advanced_search and
// unlike tweet/detail, the response is a flat
// { userName, userId, tweet_count, has_more, next_cursor, tweets: [...] }
// object rather than a { status, msg, data } envelope. Each tweet carries
// its own `author`, which is where the profile card details come from.
export function mapUserTweetsResponse(response: unknown): UserTweetsPage {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for user tweets.");
  }

  const envelope = response as Record<string, unknown>;
  if (typeof envelope.error === "string") {
    throw new Error(`GetXAPI returned an error: ${envelope.error}`);
  }

  const rawTweets = Array.isArray(envelope.tweets) ? envelope.tweets : [];

  const tweets: NetworkTweet[] = [];
  let profile: NetworkProfileInfo | null = null;

  for (const raw of rawTweets) {
    // The profile comes from any item in the page, including the replies
    // and retweets that mapRawTweet drops.
    if (!profile && raw && typeof raw === "object") {
      profile = mapAuthorToProfile((raw as Record<string, unknown>).author);
    }
    const mapped = mapRawTweet(raw);
    if (mapped) tweets.push(mapped);
  }

  const nextCursor =
    typeof envelope.next_cursor === "string" && envelope.next_cursor
      ? envelope.next_cursor
      : null;

  return {
    profile,
    tweets,
    nextCursor,
    hasMore: envelope.has_more === true && nextCursor !== null,
  };
}

export async function fetchUserTweets(
  handle: string,
  cursor: string | null = null,
): Promise<UserTweetsPage> {
  const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `${getBaseUrl()}/twitter/user/tweets?userName=${encodeURIComponent(handle)}${cursorParam}`,
    { headers: authHeaders() },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapUserTweetsResponse(body);
}

// Mirrors the mock paths in lib/getx/tweet.ts and lib/getx/search.ts: with
// no GETX_API_KEY set, Network still fills stacks so the page is usable
// end to end locally.
export function buildMockUserTweets(handle: string): UserTweetsPage {
  const now = Date.now();

  const tweets: NetworkTweet[] = Array.from({ length: 10 }, (_, i) => {
    const id = `900000000000000${String(1000 + i).slice(1)}`;
    const likeCount = 240 - i * 23;
    const metrics: TweetMetrics = {
      like_count: likeCount,
      retweet_count: Math.floor(likeCount / 4),
      reply_count: Math.floor(likeCount / 8),
    };

    return {
      x_tweet_id: id,
      author_handle: `@${handle}`,
      content: `[Mock post ${i + 1} from @${handle}] Set GETX_API_KEY to pull this account's real posts into the stack.`,
      url: `https://x.com/${handle}/status/${id}`,
      metrics,
      engagement_score:
        metrics.like_count + metrics.retweet_count + metrics.reply_count,
      posted_at: new Date(now - (i + 1) * 3600_000).toISOString(),
      // Every third mock post quotes someone, so the quote block is
      // visible without an API key.
      quoted:
        i % 3 === 1
          ? {
              handle: "someone_else",
              name: "Someone Else",
              text: "[Mock quoted post] The post being reacted to, which is the half that carries the meaning.",
              url: "https://x.com/someone_else/status/9000000000000000000",
            }
          : null,
    };
  });

  return {
    profile: {
      handle,
      displayName: handle,
      avatarUrl: null,
      bio: "Mock profile — set GETX_API_KEY for the real bio.",
      followersCount: 4200,
    },
    tweets,
    nextCursor: null,
    hasMore: false,
  };
}
