import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/security/tokenCrypto";
import { getAuthenticatedAccount } from "@/lib/x/actions";
import {
  X_OAUTH_COOKIE,
  type XOAuthHandshake,
  exchangeCodeForTokens,
  statesMatch,
} from "@/lib/x/oauth";

// Where the user lands afterwards, with the outcome in the query string so
// Settings can show it. Errors are short slugs, never the raw upstream
// message: this URL ends up in browser history and server logs.
function settingsRedirect(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", new URL(request.url).origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", new URL(request.url).origin));
  }

  const cookieStore = await cookies();
  const stored = cookieStore.get(X_OAUTH_COOKIE)?.value;
  // One-shot: clear it whatever happens, so a replayed callback can't
  // reuse the same verifier.
  cookieStore.delete(X_OAUTH_COOKIE);

  const url = new URL(request.url);
  const denied = url.searchParams.get("error");
  if (denied) {
    return settingsRedirect(request, { x_error: "denied" });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || !stored) {
    return settingsRedirect(request, { x_error: "invalid_callback" });
  }

  let handshake: XOAuthHandshake;
  try {
    handshake = JSON.parse(stored) as XOAuthHandshake;
  } catch {
    return settingsRedirect(request, { x_error: "invalid_callback" });
  }

  // CSRF check: the state coming back from X must be the one this browser
  // started with, or someone else fed us this callback.
  if (!handshake.state || !statesMatch(handshake.state, state)) {
    return settingsRedirect(request, { x_error: "state_mismatch" });
  }

  try {
    const tokens = await exchangeCodeForTokens(code, handshake.codeVerifier);

    // Resolve the account once, here: the numeric id is what the like and
    // follow endpoints need in their path on every later action.
    const account = await getAuthenticatedAccount(tokens.accessToken);

    const { error: upsertError } = await supabase.from("x_connections").upsert(
      {
        user_id: user.id,
        x_handle: account.handle,
        x_user_id: account.id,
        auth_provider: "oauth2",
        access_token_encrypted: encryptToken(tokens.accessToken),
        refresh_token_encrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        token_expires_at: tokens.expiresAt.toISOString(),
        scopes: tokens.scopes,
        // Connecting officially retires the cookie credentials for this
        // account — leaving them behind would keep a usable copy of the
        // user's session cookies for no reason.
        auth_token_encrypted: null,
        ct0_encrypted: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upsertError) throw upsertError;

    return settingsRedirect(request, { x_connected: account.handle });
  } catch (error) {
    console.error(
      "auth/x/callback failed",
      error instanceof Error ? error.message : error,
    );
    return settingsRedirect(request, { x_error: "exchange_failed" });
  }
}
