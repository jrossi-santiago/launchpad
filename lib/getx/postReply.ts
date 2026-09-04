import { authHeaders, extractErrorMessage, getBaseUrl, readBody } from "@/lib/getx/client";

export type XTestConnectionResult = { handle: string };
export type XPostReplyResult = { postedTweetId: string };

// GetXAPI has no single "resolve this session to its own handle" endpoint
// (confirmed against GetXAPI's published OpenAPI spec — the earlier guess
// at /twitter/user/verify_credentials 404'd against the live API). The
// verified two-step path: POST /twitter/user/likes resolves the auth_token
// to its owner's numeric userId (a harmless read of your own likes — the
// `likes` array itself is discarded, only `userId` is used, and this never
// mutates anything), then GET /twitter/user/info_by_id resolves that
// userId to the account's handle. Both calls are pool-priced reads
// ($0.001 each) with no side effects — nothing is liked, followed, or
// changed on the account just to test the connection.
export async function testXConnection(
  authToken: string,
  ct0: string,
): Promise<XTestConnectionResult> {
  const likesResponse = await fetch(`${getBaseUrl()}/twitter/user/likes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_token: authToken, ct0 }),
  });

  const likesBody = await readBody(likesResponse);
  if (!likesResponse.ok) {
    throw new Error(extractErrorMessage(likesBody, likesResponse.status));
  }

  const userId = mapGetXUserIdResponse(likesBody);

  const infoResponse = await fetch(
    `${getBaseUrl()}/twitter/user/info_by_id?userId=${encodeURIComponent(userId)}`,
    { headers: authHeaders() },
  );

  const infoBody = await readBody(infoResponse);
  if (!infoResponse.ok) {
    throw new Error(extractErrorMessage(infoBody, infoResponse.status));
  }

  return mapGetXTestConnectionResponse(infoBody);
}

// Isolates the /twitter/user/likes response shape — a flat
// { userId, tweet_count, has_more, next_cursor, likes } object per
// GetXAPI's spec, not wrapped in { status, msg, data } like tweet/detail.
// Defensively also checks a data-wrapped shape in case that summary was
// imprecise, so a wrong guess here is still a one-function fix.
function mapGetXUserIdResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response while resolving your account.");
  }

  const envelope = response as Record<string, unknown>;
  const container =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : envelope;

  const userId = container.userId ?? container.user_id;
  if (typeof userId !== "string" && typeof userId !== "number") {
    throw new Error("GetXAPI did not return an account id while resolving your account.");
  }

  return String(userId);
}

// Isolates the /twitter/user/info_by_id response envelope so a wrong guess
// about the field names is a one-function fix.
export function mapGetXTestConnectionResponse(response: unknown): XTestConnectionResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI connection check returned an unexpected response.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : envelope;

  const userName = (data as Record<string, unknown>).userName ?? (data as Record<string, unknown>).username;

  if (typeof userName !== "string" || !userName) {
    throw new Error("GetXAPI connection check did not return an account handle.");
  }

  return { handle: userName };
}

// VERIFIED CONTRACT — POST /twitter/tweet/create, confirmed against
// GetXAPI's published documentation. Success is a 200 with
// { status: "success", msg, data: { id, text, createdAt, ... } }; failures
// use varied HTTP statuses (400/401/409/403/429/502/503) but a consistent
// { error: string, twitter_error_code?: number } body.
export async function postReply(
  authToken: string,
  ct0: string,
  replyToTweetId: string,
  text: string,
): Promise<XPostReplyResult> {
  const response = await fetch(`${getBaseUrl()}/twitter/tweet/create`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      auth_token: authToken,
      ct0,
      text,
      reply_to_tweet_id: replyToTweetId,
    }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXPostReplyResponse(body);
}

// Isolates the verified /twitter/tweet/create success envelope.
export function mapGetXPostReplyResponse(response: unknown): XPostReplyResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for the reply.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  const id = data?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("GetXAPI did not return a tweet id for the posted reply.");
  }

  return { postedTweetId: id };
}

// Deterministic — returns a fixed mock handle whenever both authToken and
// ct0 are non-empty strings. The non-emptiness check itself happens in the
// route, not here.
export function buildMockTestConnection(): XTestConnectionResult {
  return { handle: "mock_connected_user" };
}

// Deterministic — no Math.random(), built from a fixed prefix + the tweet
// being replied to so repeated mock posts to different tweets don't
// collide.
export function buildMockPostReply(replyToTweetId: string): XPostReplyResult {
  return { postedTweetId: `mock-posted-${replyToTweetId}` };
}
