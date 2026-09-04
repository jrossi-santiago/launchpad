import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  X_AUTHORIZE_URL,
  X_OAUTH_SCOPES,
  X_TOKEN_URL,
  extractXErrorMessage,
  readBody,
  xRedirectUri,
} from "@/lib/x/client";

export type XTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string;
};

// The short-lived state carried across the round trip to X's consent
// screen. Held in an httpOnly cookie rather than the database: it is
// meaningless after the callback, and a cookie ties it to the browser that
// actually started the flow.
export type XOAuthHandshake = {
  state: string;
  codeVerifier: string;
};

export const X_OAUTH_COOKIE = "x_oauth_handshake";
export const X_OAUTH_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

// Refresh this far before the token actually expires, so an action that
// starts just under the wire doesn't fail mid-flight.
const REFRESH_LEEWAY_MS = 60_000;

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createHandshake(): XOAuthHandshake {
  return {
    state: base64Url(randomBytes(32)),
    codeVerifier: base64Url(randomBytes(64)),
  };
}

// PKCE S256: the challenge is the SHA-256 of the verifier, so the verifier
// never crosses the wire until the token exchange. This is what stops an
// intercepted authorization code from being redeemed by anyone else.
export function codeChallengeFor(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier).digest());
}

// Constant-time compare so a mismatched state can't be probed a character
// at a time. Length mismatch short-circuits, which is fine — the length is
// fixed by createHandshake() and not secret.
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function buildAuthorizeUrl(handshake: XOAuthHandshake): string {
  const redirectUri = xRedirectUri();
  if (!redirectUri) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set, so the X redirect URI cannot be built.");
  }

  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.X_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", X_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", handshake.state);
  url.searchParams.set("code_challenge", codeChallengeFor(handshake.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

// X treats us as a confidential client, so the client id/secret go in a
// Basic auth header rather than the form body.
function basicAuthHeader(): string {
  const credentials = `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function requestTokens(form: URLSearchParams): Promise<XTokenSet> {
  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractXErrorMessage(body, response.status));
  }

  return mapTokenResponse(body);
}

// Isolates the token endpoint's envelope so a wrong assumption about a
// field name is a one-function fix, in the same spirit as the GetXAPI
// mappers.
export function mapTokenResponse(body: unknown): XTokenSet {
  if (!body || typeof body !== "object") {
    throw new Error("X did not return a valid token response.");
  }

  const envelope = body as Record<string, unknown>;
  const accessToken = envelope.access_token;

  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("X did not return an access token.");
  }

  const expiresIn = typeof envelope.expires_in === "number" ? envelope.expires_in : 7200;
  const refreshToken =
    typeof envelope.refresh_token === "string" && envelope.refresh_token
      ? envelope.refresh_token
      : null;

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: typeof envelope.scope === "string" ? envelope.scope : X_OAUTH_SCOPES.join(" "),
  };
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<XTokenSet> {
  const redirectUri = xRedirectUri();
  if (!redirectUri) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set, so the X redirect URI cannot be built.");
  }

  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: process.env.X_CLIENT_ID!,
    }),
  );
}

// X rotates refresh tokens: each refresh returns a new one and the old one
// stops working. The caller must persist what comes back here, or the
// connection is dead at the next refresh.
export async function refreshTokens(refreshToken: string): Promise<XTokenSet> {
  const refreshed = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.X_CLIENT_ID!,
    }),
  );

  return {
    ...refreshed,
    // Defensive: if a refresh response ever omits the rotated token, keep
    // the one we already have rather than nulling the column and
    // stranding the connection.
    refreshToken: refreshed.refreshToken ?? refreshToken,
  };
}

export function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - REFRESH_LEEWAY_MS <= Date.now();
}
