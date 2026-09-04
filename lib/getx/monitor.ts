import { createHmac, timingSafeEqual } from "node:crypto";
import { authHeaders, extractErrorMessage, getBaseUrl, readBody } from "@/lib/getx/client";
import { mapRawTweet, type NetworkTweet } from "@/lib/getx/userTweets";

export type MonitorWebhook = {
  webhookId: string;
  signingSecret: string;
};

// GetXAPI rejects any webhook URL that does not resolve to a public
// address, so there is nothing to register while running on localhost.
// Returning null here is the switch that puts a user in poll-only mode:
// stacks still fill on page load and Refresh, new posts just don't arrive
// on their own. For local testing, point NEXT_PUBLIC_APP_URL at an ngrok
// or cloudflared tunnel.
export function monitorWebhookUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!base) return null;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
    return null;
  }

  return `${url.origin}/api/network/webhook`;
}

export function monitoringConfigured(): boolean {
  return Boolean(process.env.GETX_API_KEY) && monitorWebhookUrl() !== null;
}

// The monitor endpoints document their status codes but not their success
// bodies, so every field is read defensively out of either the top level
// or a `data` wrapper. A missing id is an error, not a silent null: the id
// is the only handle we have for removing the monitor later, and a monitor
// we cannot remove holds a plan slot forever.
function readField(body: unknown, ...names: string[]): string | null {
  if (!body || typeof body !== "object") return null;
  const envelope = body as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  for (const name of names) {
    const value = envelope[name] ?? data?.[name];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

async function postMonitor(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }
  return body;
}

// POST /twitter/monitor/webhook/create. The signing secret comes back
// exactly once and is never returned again, so the caller must persist it
// before doing anything else.
export async function createMonitorWebhook(url: string): Promise<MonitorWebhook> {
  const body = await postMonitor("/twitter/monitor/webhook/create", { url });

  const webhookId = readField(body, "webhook_id", "id");
  const signingSecret = readField(body, "signing_secret", "secret");

  if (!webhookId || !signingSecret) {
    throw new Error("GetXAPI did not return a webhook id and signing secret.");
  }

  return { webhookId, signingSecret };
}

// POST /twitter/monitor/add. include_replies stays false: Network carries
// a person's own original posts only.
export async function addMonitor(handle: string, webhookId: string): Promise<string> {
  const body = await postMonitor("/twitter/monitor/add", {
    userName: handle,
    webhook_id: webhookId,
    include_replies: false,
  });

  const monitorId = readField(body, "monitor_id", "id");
  if (!monitorId) {
    throw new Error("GetXAPI did not return a monitor id.");
  }
  return monitorId;
}

// POST /twitter/monitor/remove. Per the API docs this is the only way to
// free the plan slot a monitor occupies — pausing keeps it — which is why
// removing someone from Network calls this rather than pausing.
export async function removeMonitor(monitorId: string): Promise<void> {
  await postMonitor("/twitter/monitor/remove", { monitor_id: monitorId });
}

// UNVERIFIED CONTRACT — GetXAPI documents that deliveries are "HMAC-signed"
// and that /webhook/create returns the signing secret, but publishes
// neither the header name nor the signing scheme. This checks the raw body
// against HMAC-SHA256 under every header name the service plausibly uses,
// in both bare-hex and "sha256=" forms. If a delivery ever fails to verify
// against a secret we know is right, this function is the one place to fix.
const SIGNATURE_HEADERS = [
  "x-getxapi-signature",
  "x-getx-signature",
  "x-webhook-signature",
  "x-signature",
  "x-hub-signature-256",
];

export function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  for (const name of SIGNATURE_HEADERS) {
    const provided = headers.get(name);
    if (!provided) continue;

    const candidate = provided.trim().replace(/^sha256=/i, "");
    const candidateBuffer = Buffer.from(candidate, "utf8");
    if (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    ) {
      return true;
    }
  }

  return false;
}

export type MonitorDelivery =
  | { kind: "test" }
  | { kind: "tweet"; handle: string; tweet: NetworkTweet }
  | { kind: "ignored" };

// UNVERIFIED CONTRACT — the docs describe the test payload ("type 'test'
// and no tweet field") but not the tweet payload's exact shape. The tweet
// object itself is the same one /twitter/user/tweets returns, so it goes
// through the same mapper, and "ignored" covers both an unrecognised
// payload and a delivery that turned out to be a reply or retweet.
export function mapMonitorDelivery(payload: unknown): MonitorDelivery {
  if (!payload || typeof payload !== "object") return { kind: "ignored" };
  const envelope = payload as Record<string, unknown>;

  if (envelope.type === "test") return { kind: "test" };

  const rawTweet =
    envelope.tweet && typeof envelope.tweet === "object" ? envelope.tweet : null;
  if (!rawTweet) return { kind: "ignored" };

  const tweet = mapRawTweet(rawTweet);
  if (!tweet) return { kind: "ignored" };

  const handleFromPayload =
    typeof envelope.userName === "string" ? envelope.userName : null;
  const handle = (handleFromPayload ?? tweet.author_handle).replace(/^@/, "");

  return { kind: "tweet", handle, tweet };
}
