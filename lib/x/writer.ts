import type { createClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/security/tokenCrypto";
import { XApiError, xOAuthConfigured } from "@/lib/x/client";
import { isExpired, refreshTokens } from "@/lib/x/oauth";
import {
  followUser as xFollowUser,
  likeTweet as xLikeTweet,
  lookupUserByUsername as xLookupUserByUsername,
  postTweet as xPostTweet,
} from "@/lib/x/actions";
import { buildMockFavorite, buildMockFollow, favoriteTweet, followUser } from "@/lib/getx/actions";
import { buildMockPostReply, postReply } from "@/lib/getx/postReply";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type XConnectionRow = {
  user_id: string;
  x_handle: string | null;
  auth_provider: string | null;
  x_user_id: string | null;
  auth_token_encrypted: string | null;
  ct0_encrypted: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
};

export type XPostResult = { postedTweetId: string };
export type XLikeResult = { liked: boolean };
export type XFollowResult = { following: boolean; pending: boolean };

// Thrown when the stored connection itself is the problem — missing,
// undecryptable, or holding a refresh token X has rejected. Routes turn
// this into a 400 that tells the user to reconnect, as distinct from a
// transient API failure, which is a 502.
export class XConnectionError extends Error {
  constructor(message = "Your X connection needs to be reconnected in Settings.") {
    super(message);
    this.name = "XConnectionError";
  }
}

export type WriteProvider = "oauth2" | "getx" | "mock";

// Which path a given connection actually writes through. Decided per
// connection row, not globally: a user who connected with cookies before
// the OAuth migration keeps working until they reconnect, and a user who
// has connected officially is never silently downgraded to the cookie
// path. With neither configured we fall through to the deterministic mock
// path, so the whole app stays runnable with no keys set.
export function resolveWriteProvider(connection: XConnectionRow): WriteProvider {
  if (
    connection.auth_provider === "oauth2" &&
    connection.access_token_encrypted &&
    xOAuthConfigured()
  ) {
    return "oauth2";
  }

  if (process.env.GETX_API_KEY && connection.auth_token_encrypted) {
    return "getx";
  }

  return "mock";
}

// Returns a usable access token, refreshing and persisting first if the
// stored one is at or near expiry. Persisting matters: X rotates refresh
// tokens on every use, so dropping the new one here would strand the
// connection at the next refresh.
async function accessTokenFor(
  supabase: SupabaseServerClient,
  connection: XConnectionRow,
): Promise<{ accessToken: string; refreshTokenEncrypted: string | null }> {
  if (!connection.access_token_encrypted) {
    throw new XConnectionError();
  }

  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null;

  if (!isExpired(expiresAt)) {
    try {
      return {
        accessToken: decryptToken(connection.access_token_encrypted),
        refreshTokenEncrypted: connection.refresh_token_encrypted,
      };
    } catch {
      throw new XConnectionError();
    }
  }

  if (!connection.refresh_token_encrypted) {
    throw new XConnectionError();
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(connection.refresh_token_encrypted);
  } catch {
    throw new XConnectionError();
  }

  let tokens;
  try {
    tokens = await refreshTokens(refreshToken);
  } catch (error) {
    console.error(
      "x/writer failed to refresh access token",
      error instanceof Error ? error.message : error,
    );
    throw new XConnectionError();
  }

  await persistTokens(supabase, connection.user_id, tokens);

  return {
    accessToken: tokens.accessToken,
    // The rotated token, so a retry below refreshes from the token X now
    // considers current rather than the stale one on the connection row.
    refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
  };
}

export async function persistTokens(
  supabase: SupabaseServerClient,
  userId: string,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string },
): Promise<void> {
  const { error } = await supabase
    .from("x_connections")
    .update({
      access_token_encrypted: encryptToken(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      token_expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) throw error;
}

// Runs an official-API call, and on a 401 refreshes once and retries. A
// 401 here means the access token was rejected despite looking unexpired
// (clock skew, or a token revoked from X's side), and one forced refresh
// is the difference between a silent failure and a working action.
async function withAccessToken<T>(
  supabase: SupabaseServerClient,
  connection: XConnectionRow,
  run: (accessToken: string) => Promise<T>,
): Promise<T> {
  const { accessToken, refreshTokenEncrypted } = await accessTokenFor(supabase, connection);

  try {
    return await run(accessToken);
  } catch (error) {
    if (!(error instanceof XApiError) || error.status !== 401) throw error;

    if (!refreshTokenEncrypted) throw new XConnectionError();

    let refreshed;
    try {
      refreshed = await refreshTokens(decryptToken(refreshTokenEncrypted));
    } catch {
      throw new XConnectionError();
    }

    await persistTokens(supabase, connection.user_id, refreshed);
    return run(refreshed.accessToken);
  }
}

function cookieCredentials(connection: XConnectionRow): { authToken: string; ct0: string } {
  if (!connection.auth_token_encrypted || !connection.ct0_encrypted) {
    throw new XConnectionError();
  }

  try {
    return {
      authToken: decryptToken(connection.auth_token_encrypted),
      ct0: decryptToken(connection.ct0_encrypted),
    };
  } catch {
    throw new XConnectionError();
  }
}

// Posts as the connected user. `replyToTweetId` null means a standalone
// post — the shape a scheduler needs — and a tweet id makes it a reply,
// which is what every button in the app does today.
export async function postAs(
  supabase: SupabaseServerClient,
  connection: XConnectionRow,
  text: string,
  replyToTweetId: string | null,
): Promise<XPostResult> {
  switch (resolveWriteProvider(connection)) {
    case "oauth2":
      return withAccessToken(supabase, connection, (accessToken) =>
        xPostTweet(accessToken, text, replyToTweetId),
      );

    case "getx": {
      if (!replyToTweetId) {
        // GetXAPI's create endpoint is only wired here for replies. A
        // standalone post through the cookie path is exactly the
        // ban-prone pattern this migration exists to avoid, so it is
        // refused rather than quietly enabled.
        throw new XConnectionError(
          "Posting standalone posts requires an officially connected X account. Reconnect X in Settings.",
        );
      }
      const { authToken, ct0 } = cookieCredentials(connection);
      return postReply(authToken, ct0, replyToTweetId, text);
    }

    default:
      return buildMockPostReply(replyToTweetId ?? "standalone");
  }
}

export async function likeAs(
  supabase: SupabaseServerClient,
  connection: XConnectionRow,
  tweetId: string,
): Promise<XLikeResult> {
  switch (resolveWriteProvider(connection)) {
    case "oauth2": {
      if (!connection.x_user_id) throw new XConnectionError();
      return withAccessToken(supabase, connection, (accessToken) =>
        xLikeTweet(accessToken, connection.x_user_id!, tweetId),
      );
    }

    case "getx": {
      const { authToken } = cookieCredentials(connection);
      return favoriteTweet(authToken, tweetId);
    }

    default:
      return buildMockFavorite();
  }
}

// `username` must be bare, with no leading "@" — callers strip it from the
// stored handle so the stripping stays visible at the call site.
export async function followAs(
  supabase: SupabaseServerClient,
  connection: XConnectionRow,
  username: string,
): Promise<XFollowResult> {
  switch (resolveWriteProvider(connection)) {
    case "oauth2": {
      if (!connection.x_user_id) throw new XConnectionError();
      return withAccessToken(supabase, connection, async (accessToken) => {
        // The official follow endpoint takes the target's numeric id, so
        // the handle has to be resolved first. This is a billed user read
        // on top of the follow itself — the one place the official path
        // costs an extra call that the cookie path did not.
        const target = await xLookupUserByUsername(accessToken, username);
        return xFollowUser(accessToken, connection.x_user_id!, target.id);
      });
    }

    case "getx": {
      const { authToken } = cookieCredentials(connection);
      const result = await followUser(authToken, username);
      return { following: result.following, pending: false };
    }

    default: {
      const result = buildMockFollow(username);
      return { following: result.following, pending: false };
    }
  }
}
