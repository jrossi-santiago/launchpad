import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/tokenCrypto";
import {
  addMonitor,
  createMonitorWebhook,
  monitorWebhookUrl,
  removeMonitor,
} from "@/lib/getx/monitor";

export type MonitorAttachment = {
  monitorId: string | null;
  status: "none" | "active";
  error: string | null;
};

// Poll-only is a normal, working state — stacks still fill on page load and
// on Refresh — so every failure here is reported as a reason string that
// the stack header shows, never as a thrown error that would stop someone
// from being added to Network.
function poll(reason: string): MonitorAttachment {
  return { monitorId: null, status: "none", error: reason };
}

// One webhook per user, created on first use and reused afterwards. The
// signing secret GetXAPI returns is shown exactly once, so it is encrypted
// and stored in the same transaction-ish step that records the webhook id.
async function ensureWebhook(userId: string, url: string): Promise<string> {
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("network_webhooks")
    .select("webhook_id, url")
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing && existing.url === url) return String(existing.webhook_id);

  const webhook = await createMonitorWebhook(url);

  const { error: upsertError } = await admin.from("network_webhooks").upsert(
    {
      user_id: userId,
      webhook_id: webhook.webhookId,
      url,
      signing_secret_encrypted: encryptToken(webhook.signingSecret),
    },
    { onConflict: "user_id" },
  );

  if (upsertError) throw upsertError;
  return webhook.webhookId;
}

// Reads back a stored signing secret for the webhook route. Returns null
// rather than throwing so an unverifiable delivery is rejected quietly.
export async function loadWebhookSecret(
  encrypted: string,
): Promise<string | null> {
  try {
    return decryptToken(encrypted);
  } catch {
    return null;
  }
}

// Best-effort: turn on real-time delivery for one handle. Called when a
// profile is added; a failure downgrades that profile to poll-only.
export async function attachMonitor(
  userId: string,
  handle: string,
): Promise<MonitorAttachment> {
  if (!process.env.GETX_API_KEY) {
    return poll("Poll-only: no GETX_API_KEY set.");
  }

  const url = monitorWebhookUrl();
  if (!url) {
    return poll(
      "Poll-only: set NEXT_PUBLIC_APP_URL to a public HTTPS URL to get live posts.",
    );
  }

  try {
    const webhookId = await ensureWebhook(userId, url);
    const monitorId = await addMonitor(handle, webhookId);
    return { monitorId, status: "active", error: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Monitoring could not be enabled.";
    return poll(`Poll-only: ${message}`);
  }
}

// Removing an account from Network calls monitor/remove rather than
// pausing, because per GetXAPI's docs removal is the only thing that frees
// the plan slot. Failure is swallowed: the profile still goes away locally,
// and a stranded monitor is a smaller problem than a row that will not
// delete.
export async function detachMonitor(monitorId: string | null): Promise<void> {
  if (!monitorId || !process.env.GETX_API_KEY) return;
  try {
    await removeMonitor(monitorId);
  } catch (error) {
    console.error("network monitor remove failed", error);
  }
}
