import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapMonitorDelivery, verifyWebhookSignature } from "@/lib/getx/monitor";
import { loadWebhookSecret } from "@/lib/network/monitoring";
import { ingestTweets } from "@/lib/network/stack";

type WebhookRow = {
  user_id: string;
  webhook_id: string;
  signing_secret_encrypted: string;
};

// Inbound GetXAPI monitor delivery: a new post by a watched account.
//
// This is the one route with no user session — GetXAPI is the caller — so
// the request is authenticated entirely by its HMAC signature over the raw
// body, and only then does it touch the database with the service-role
// client. Nothing here is trusted until a signature matches.
//
// Real-time delivery is a bonus on top of polling, not a dependency: if
// this route is unreachable (no public URL, monitoring not on the plan),
// stacks still fill on page load and on Refresh.
export async function POST(request: Request) {
  const rawBody = await request.text();

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("network/webhook admin client unavailable", error);
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const { data: webhooks, error: webhooksError } = await admin
    .from("network_webhooks")
    .select("user_id, webhook_id, signing_secret_encrypted");

  if (webhooksError) {
    console.error("network/webhook lookup failed", webhooksError);
    return NextResponse.json({ error: "Webhook lookup failed." }, { status: 500 });
  }

  // The delivery payload's documented shape doesn't include the webhook
  // id, so the matching secret is found by trying each one. There is at
  // most one webhook per user and the comparison is timing-safe.
  let matched: WebhookRow | null = null;
  for (const raw of (webhooks ?? []) as WebhookRow[]) {
    const secret = await loadWebhookSecret(raw.signing_secret_encrypted);
    if (!secret) continue;
    if (verifyWebhookSignature(rawBody, request.headers, secret)) {
      matched = raw;
      break;
    }
  }

  if (!matched) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const delivery = mapMonitorDelivery(payload);

  // A test delivery and a reply/retweet we deliberately drop both need a
  // 200: anything else makes GetXAPI record the webhook as failing.
  if (delivery.kind !== "tweet") {
    return NextResponse.json({ ok: true, ignored: delivery.kind === "ignored" });
  }

  const { data: profile, error: profileError } = await admin
    .from("network_profiles")
    .select("id")
    .eq("user_id", matched.user_id)
    .eq("handle", delivery.handle)
    .maybeSingle();

  if (profileError) {
    console.error("network/webhook profile lookup failed", profileError);
    return NextResponse.json({ error: "Profile lookup failed." }, { status: 500 });
  }

  // The account was removed from Network but the monitor outlived it.
  if (!profile) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const inserted = await ingestTweets(
      admin,
      matched.user_id,
      String((profile as { id: string }).id),
      [delivery.tweet],
      "monitor",
    );
    return NextResponse.json({ ok: true, inserted });
  } catch (error) {
    console.error("network/webhook ingest failed", error);
    return NextResponse.json({ error: "Ingest failed." }, { status: 500 });
  }
}
