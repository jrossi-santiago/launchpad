import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { xOAuthConfigured, xRedirectUri } from "@/lib/x/client";
import {
  X_OAUTH_COOKIE,
  X_OAUTH_COOKIE_MAX_AGE_SECONDS,
  buildAuthorizeUrl,
  createHandshake,
} from "@/lib/x/oauth";

// Step one of connecting an X account: mint a PKCE handshake, stash it in
// a short-lived httpOnly cookie, and hand the browser X's consent screen.
// Nothing is written to the database until the callback comes back with a
// code that matches this handshake.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "X sign-in is not configured on this server. X_CLIENT_ID, X_CLIENT_SECRET and NEXT_PUBLIC_APP_URL must all be set.",
      },
      { status: 500 },
    );
  }

  // Same reason the connection save refuses to run without it: there is no
  // safe mock for encryption, and we are about to receive tokens we must
  // store encrypted.
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.error("auth/x/start misconfigured: TOKEN_ENCRYPTION_KEY is not set");
    return NextResponse.json(
      { error: "Server misconfigured: TOKEN_ENCRYPTION_KEY is not set." },
      { status: 500 },
    );
  }

  const handshake = createHandshake();

  // A `secure` cookie is silently dropped over plain http, which would
  // surface as an unexplained "invalid callback" on a localhost dev
  // origin. Match the flag to the origin the callback will actually use.
  const isHttps = xRedirectUri()!.startsWith("https://");

  const cookieStore = await cookies();
  cookieStore.set(X_OAUTH_COOKIE, JSON.stringify(handshake), {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax", // must survive the top-level redirect back from x.com
    path: "/",
    maxAge: X_OAUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return NextResponse.json({ authorizeUrl: buildAuthorizeUrl(handshake) });
}
