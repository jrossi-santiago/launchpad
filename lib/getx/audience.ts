import { authHeaders, extractErrorMessage, getBaseUrl, readBody } from "@/lib/getx/client";

export type AudienceMember = {
  handle: string; // bare, no leading "@" — see AGENTS.md Lesson 6
  name: string | null;
  bio: string | null;
  followersCount: number | null;
};

export type AudiencePage = {
  members: AudienceMember[];
  nextCursor: string | null;
  hasMore: boolean;
};

// Shared by both mappers below — GetXAPI's TweetAuthor (replies) and User
// (retweeters) schemas both carry userName/name/description/followers,
// verified against https://docs.getxapi.com/openapi.json.
function mapAuthorToMember(raw: unknown): AudienceMember | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const userName = item.userName;
  if (typeof userName !== "string" || !userName) return null;

  return {
    handle: userName.replace(/^@/, ""),
    name: typeof item.name === "string" ? item.name : null,
    bio: typeof item.description === "string" ? item.description : null,
    followersCount: typeof item.followers === "number" ? item.followers : null,
  };
}

// VERIFIED CONTRACT — GET /twitter/tweet/replies, confirmed against
// GetXAPI's published OpenAPI spec (https://docs.getxapi.com/openapi.json).
// No auth_token/ct0 required — bearer API key only (same as tweet/detail).
// Success is a 200 with { tweetId, reply_count, has_more, next_cursor,
// replies: [{ ..., author: { userName, name, description, followers } }] }.
export function mapGetXRepliesResponse(response: unknown): AudiencePage {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for replies.");
  }

  const envelope = response as Record<string, unknown>;
  if (typeof envelope.error === "string") {
    throw new Error(`GetXAPI returned an error: ${envelope.error}`);
  }

  const replies = Array.isArray(envelope.replies) ? envelope.replies : [];
  const members: AudienceMember[] = [];
  for (const raw of replies) {
    if (!raw || typeof raw !== "object") continue;
    const member = mapAuthorToMember((raw as Record<string, unknown>).author);
    if (member) members.push(member);
  }

  return {
    members,
    nextCursor: typeof envelope.next_cursor === "string" ? envelope.next_cursor : null,
    hasMore: envelope.has_more === true,
  };
}

// VERIFIED CONTRACT — GET /twitter/tweet/retweeters, confirmed against
// GetXAPI's published OpenAPI spec. No auth_token/ct0 required. Success is
// a 200 with { tweetId, user_count, has_more, next_cursor, users: [{
// userName, name, description, followers, ... }] }.
export function mapGetXRetweetersResponse(response: unknown): AudiencePage {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for retweeters.");
  }

  const envelope = response as Record<string, unknown>;
  if (typeof envelope.error === "string") {
    throw new Error(`GetXAPI returned an error: ${envelope.error}`);
  }

  const users = Array.isArray(envelope.users) ? envelope.users : [];
  const members: AudienceMember[] = [];
  for (const raw of users) {
    const member = mapAuthorToMember(raw);
    if (member) members.push(member);
  }

  return {
    members,
    nextCursor: typeof envelope.next_cursor === "string" ? envelope.next_cursor : null,
    hasMore: envelope.has_more === true,
  };
}

export async function fetchReplies(tweetId: string, cursor: string | null): Promise<AudiencePage> {
  const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `${getBaseUrl()}/twitter/tweet/replies?id=${encodeURIComponent(tweetId)}${cursorParam}`,
    { headers: authHeaders() },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXRepliesResponse(body);
}

export async function fetchRetweeters(tweetId: string, cursor: string | null): Promise<AudiencePage> {
  const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `${getBaseUrl()}/twitter/tweet/retweeters?id=${encodeURIComponent(tweetId)}${cursorParam}`,
    { headers: authHeaders() },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXRetweetersResponse(body);
}

// The mock path has no real cursor to hand back and forth, so the mock
// cursor IS the next page number as a string — deterministic, no
// Math.random(), and the route doesn't need a mock-vs-live branch beyond
// picking which builder to call. Page 1 is requested with cursor === null.
export function parseMockAudienceCursor(cursor: string | null): number {
  if (!cursor) return 1;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

// Deterministic, no Math.random(). pageIndex 1..5 each return 5 members;
// page 5 returns hasMore: false so the "page N of 5" progress UI is
// testable end-to-end with no GETX_API_KEY set.
export function buildMockAudiencePage(pageIndex: number): AudiencePage {
  const page = Math.min(Math.max(Math.trunc(pageIndex), 1), 5);
  const members: AudienceMember[] = Array.from({ length: 5 }, (_, i) => {
    const n = (page - 1) * 5 + i + 1;
    return {
      handle: `mock_audience_${n}`,
      name: `Mock Audience Member ${n}`,
      bio: "Set GETX_API_KEY to pull this person's real bio.",
      followersCount: n * 113,
    };
  });

  const hasMore = page < 5;
  return {
    members,
    nextCursor: hasMore ? String(page + 1) : null,
    hasMore,
  };
}
