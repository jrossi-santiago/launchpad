import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/security/tokenCrypto";
import { buildMockTestConnection, testXConnection } from "@/lib/getx/postReply";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fail loudly before touching credentials at all — there is no safe mock
  // for encryption (Lesson 11).
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.error("settings/x-connection misconfigured: TOKEN_ENCRYPTION_KEY is not set");
    return NextResponse.json(
      { error: "Server misconfigured: TOKEN_ENCRYPTION_KEY is not set." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const authToken =
    body && typeof body === "object" && typeof (body as { auth_token?: unknown }).auth_token === "string"
      ? (body as { auth_token: string }).auth_token
      : null;
  const ct0 =
    body && typeof body === "object" && typeof (body as { ct0?: unknown }).ct0 === "string"
      ? (body as { ct0: string }).ct0
      : null;

  if (!authToken || !ct0) {
    return NextResponse.json(
      { error: "Both auth_token and ct0 are required." },
      { status: 400 },
    );
  }

  try {
    const result = process.env.GETX_API_KEY
      ? await testXConnection(authToken, ct0)
      : buildMockTestConnection();

    let authTokenEncrypted: string;
    let ct0Encrypted: string;
    try {
      authTokenEncrypted = encryptToken(authToken);
      ct0Encrypted = encryptToken(ct0);
    } catch (error) {
      console.error("settings/x-connection failed to encrypt tokens", error);
      return NextResponse.json(
        { error: "Server misconfigured: TOKEN_ENCRYPTION_KEY is not set." },
        { status: 500 },
      );
    }

    const { error: upsertError } = await supabase.from("x_connections").upsert(
      {
        user_id: user.id,
        x_handle: result.handle,
        auth_token_encrypted: authTokenEncrypted,
        ct0_encrypted: ct0Encrypted,
        // Explicit, not relying on the column default: this row may already
        // say "oauth2" from an earlier official connection, and leaving it
        // would route writes at OAuth columns this save just cleared.
        auth_provider: "cookie",
        x_user_id: null,
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        scopes: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upsertError) throw upsertError;

    return NextResponse.json({ connected: true, handle: result.handle });
  } catch (error) {
    console.error(
      "settings/x-connection failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not connect that X account. Please check the pasted values and try again.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("x_connections")
    .update({
      x_handle: null,
      auth_token_encrypted: null,
      ct0_encrypted: null,
      auth_provider: "cookie",
      x_user_id: null,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      scopes: null,
      connected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    console.error("settings/x-connection failed to disconnect", error);
    return NextResponse.json(
      { error: "Failed to disconnect. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ connected: false });
}
