import { authHeaders, extractErrorMessage, getBaseUrl, readBody } from "@/lib/getx/client";

export type XFavoriteResult = { liked: boolean };
export type XFollowResult = { following: boolean; userName: string };

// VERIFIED CONTRACT — POST /twitter/tweet/favorite, confirmed against
// GetXAPI's published OpenAPI spec (https://docs.getxapi.com/openapi.json).
// Success is a 200 with { status: "success", msg, data: { tweetId, liked } }.
export async function favoriteTweet(
  authToken: string,
  tweetId: string,
): Promise<XFavoriteResult> {
  const response = await fetch(`${getBaseUrl()}/twitter/tweet/favorite`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_token: authToken, tweet_id: tweetId }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXFavoriteResponse(body);
}

// Isolates the verified /twitter/tweet/favorite success envelope.
function mapGetXFavoriteResponse(response: unknown): XFavoriteResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for the like.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  if (data?.liked !== true) {
    throw new Error("GetXAPI did not confirm the like.");
  }

  return { liked: true };
}

// VERIFIED CONTRACT — POST /twitter/user/follow, confirmed against
// GetXAPI's published OpenAPI spec. `username` must already be a bare
// screen name (no leading "@") — the caller strips it, not this function,
// so the stripping is visible right next to where tweet.author_handle is
// read. Success is a 200 with { status: "success", msg, data: { userId,
// userName, name, following, followRequestSent, protected } }.
export async function followUser(
  authToken: string,
  username: string,
): Promise<XFollowResult> {
  const response = await fetch(`${getBaseUrl()}/twitter/user/follow`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_token: authToken, username }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXFollowResponse(body);
}

// Isolates the verified /twitter/user/follow success envelope.
function mapGetXFollowResponse(response: unknown): XFollowResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for the follow.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  const userName = data?.userName;
  if (data?.following !== true || typeof userName !== "string" || !userName) {
    throw new Error("GetXAPI did not confirm the follow.");
  }

  return { following: true, userName };
}

// Deterministic — { liked: true } every time, no Math.random().
export function buildMockFavorite(): XFavoriteResult {
  return { liked: true };
}

// Deterministic — no Math.random(), built from the username passed in so
// the mock result always reflects who was "followed".
export function buildMockFollow(username: string): XFollowResult {
  return { following: true, userName: username };
}
