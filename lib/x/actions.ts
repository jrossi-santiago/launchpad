import {
  X_API_BASE_URL,
  XApiError,
  describeXWriteFailure,
  extractXErrorMessage,
  readBody,
} from "@/lib/x/client";

export type XPostResult = { postedTweetId: string };
export type XLikeResult = { liked: boolean };
export type XFollowResult = { following: boolean; pending: boolean };
export type XAccount = { id: string; handle: string };

// One place where an access token becomes a request, so the bearer header
// is never hand-assembled at a call site.
async function xFetch(
  accessToken: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  const response = await fetch(`${X_API_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new XApiError(
      describeXWriteFailure(
        response.status,
        extractXErrorMessage(body, response.status),
        response.headers.get("x-rate-limit-reset"),
      ),
      response.status,
    );
  }

  return body;
}

// VERIFIED CONTRACT — GET /2/users/me, confirmed against X's published API
// reference. Returns { data: { id, name, username } }. Called once at
// connect time: the numeric id it returns is what the like and follow
// endpoints need in their path, so storing it here saves a lookup (and a
// billed user read) on every subsequent action.
export async function getAuthenticatedAccount(accessToken: string): Promise<XAccount> {
  const body = await xFetch(accessToken, "/2/users/me");
  return mapAccountResponse(body);
}

export function mapAccountResponse(body: unknown): XAccount {
  const data = readData(body);
  const id = data?.id;
  const username = data?.username;

  if (typeof id !== "string" || !id || typeof username !== "string" || !username) {
    throw new Error("X did not return the connected account's id and handle.");
  }

  return { id, handle: username };
}

// VERIFIED CONTRACT — POST /2/tweets, confirmed against X's published API
// reference. A reply is the same call with a `reply.in_reply_to_tweet_id`
// object, which is why this one function serves both the reply buttons
// today and a scheduled standalone post later: omit replyToTweetId and it
// posts to the timeline.
// Success is a 201 with { data: { id, text, edit_history_post_ids } }.
export async function postTweet(
  accessToken: string,
  text: string,
  replyToTweetId?: string | null,
): Promise<XPostResult> {
  const body = await xFetch(accessToken, "/2/tweets", {
    method: "POST",
    body: {
      text,
      ...(replyToTweetId ? { reply: { in_reply_to_tweet_id: replyToTweetId } } : {}),
    },
  });

  return mapPostResponse(body);
}

export function mapPostResponse(body: unknown): XPostResult {
  const data = readData(body);
  const id = data?.id;

  if (typeof id !== "string" || !id) {
    throw new Error("X did not return a post id for the published post.");
  }

  return { postedTweetId: id };
}

// VERIFIED CONTRACT — POST /2/users/{id}/likes, confirmed against X's
// published API reference. `userId` is the *connected* account (the one
// doing the liking), not the tweet's author. Success is a 200 with
// { data: { liked: boolean } }.
export async function likeTweet(
  accessToken: string,
  userId: string,
  tweetId: string,
): Promise<XLikeResult> {
  const body = await xFetch(accessToken, `/2/users/${encodeURIComponent(userId)}/likes`, {
    method: "POST",
    body: { tweet_id: tweetId },
  });

  const data = readData(body);
  if (data?.liked !== true) {
    throw new Error("X did not confirm the like.");
  }

  return { liked: true };
}

// VERIFIED CONTRACT — POST /2/users/{id}/following, confirmed against X's
// published API reference. This endpoint takes the target's *numeric id*,
// not their handle, so a follow is two calls: resolve the handle, then
// follow. Success is a 200 with { data: { following, pending_follow } }.
export async function followUser(
  accessToken: string,
  userId: string,
  targetUserId: string,
): Promise<XFollowResult> {
  const body = await xFetch(accessToken, `/2/users/${encodeURIComponent(userId)}/following`, {
    method: "POST",
    body: { target_user_id: targetUserId },
  });

  const data = readData(body);
  const following = data?.following === true;
  const pending = data?.pending_follow === true;

  // A protected account returns following:false with pending_follow:true.
  // That is a success — the request was sent — so it must not read as a
  // failure to the user.
  if (!following && !pending) {
    throw new Error("X did not confirm the follow.");
  }

  return { following, pending };
}

// VERIFIED CONTRACT — GET /2/users/by/username/{username}, confirmed
// against X's published API reference. `username` must be bare, with no
// leading "@" — the caller strips it, so the stripping stays visible next
// to where the stored handle is read.
export async function lookupUserByUsername(
  accessToken: string,
  username: string,
): Promise<XAccount> {
  const body = await xFetch(
    accessToken,
    `/2/users/by/username/${encodeURIComponent(username)}`,
  );
  return mapAccountResponse(body);
}

// Every v2 endpoint used here wraps its payload in `data`. Kept in one
// helper so a shape surprise is a single fix rather than five.
function readData(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const envelope = body as Record<string, unknown>;
  if (!envelope.data || typeof envelope.data !== "object") return null;
  return envelope.data as Record<string, unknown>;
}
