// Shared plumbing for the official X API v2. Mirrors lib/getx/client.ts so
// the two providers read the same way at their call sites, but the error
// shape is X's, not GetXAPI's.

export const X_API_BASE_URL = "https://api.x.com";

// Carries the HTTP status alongside the message so callers can branch on
// it — the write path retries exactly once on a 401 after refreshing the
// token, and matching on message text to do that would be brittle.
export class XApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "XApiError";
    this.status = status;
  }
}

// X's OAuth 2.0 endpoints live on different hosts: the consent screen is
// on x.com (a human visits it), the token exchange is on api.x.com.
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";

// Everything the write path needs. offline.access is what makes X issue a
// refresh token — without it a connection silently dies a couple of hours
// after the user connects, which is exactly the failure a scheduler must
// never have.
export const X_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "like.write",
  "follows.write",
  "offline.access",
] as const;

export function xOAuthConfigured(): boolean {
  return Boolean(
    process.env.X_CLIENT_ID &&
      process.env.X_CLIENT_SECRET &&
      xRedirectUri() !== null,
  );
}

// The redirect URI must match what is registered in the X developer app
// exactly, so it is derived from one env var in one place rather than
// rebuilt per route.
export function xRedirectUri(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!base) return null;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }

  return `${url.origin}/api/auth/x/callback`;
}

// Reads a fetch Response body once, as JSON if possible, falling back to
// text — same contract as readBody() in lib/getx/client.ts so an error
// path never double-reads the stream.
export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// X API v2 errors come in three shapes depending on which layer rejected
// the request:
//   - a problem object: { title, detail, type, status }
//   - a partial-failure array: { errors: [{ message | detail | title }] }
//   - an OAuth error: { error, error_description }
// This collapses all three into one sentence a user can act on. It never
// echoes the request body, so a token can't leak into an error message.
export function extractXErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const envelope = body as Record<string, unknown>;

    if (typeof envelope.error_description === "string" && envelope.error_description.trim()) {
      return envelope.error_description.trim();
    }
    if (typeof envelope.error === "string" && envelope.error.trim()) {
      return envelope.error.trim();
    }

    const detail = envelope.detail;
    const title = envelope.title;
    if (typeof detail === "string" && detail.trim()) {
      return typeof title === "string" && title.trim() && !detail.includes(title)
        ? `${title}: ${detail}`
        : detail.trim();
    }
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }

    if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
      const first = envelope.errors[0];
      if (first && typeof first === "object") {
        const item = first as Record<string, unknown>;
        for (const key of ["message", "detail", "title"] as const) {
          const value = item[key];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
      }
    }
  }

  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  return `X API request failed with status ${status}.`;
}

// Since 23 Feb 2026 X refuses programmatic replies on every self-serve
// plan (Free, Basic, Pro and Pay-Per-Use): an app may only reply to a post
// whose author @mentioned or quoted it. Enterprise and Public Utility apps
// are exempt. It surfaces as a 403 whose message is about being mentioned
// or being the author, and it is not something different wording fixes —
// so it must not be reported as a duplicate-content rejection.
function isProgrammaticReplyRestriction(apiMessage: string): boolean {
  const message = apiMessage.toLowerCase();
  return (
    message.includes("only reply to or quote") ||
    (message.includes("mentioned") && message.includes("author"))
  );
}

// Turns the handful of statuses a user can actually do something about
// into plain language, and leaves everything else to the API's own
// message. The 403s are worth separating: they have unrelated causes and
// unrelated fixes, and reporting the wrong one sends someone off editing
// text that was never the problem.
export function describeXWriteFailure(
  status: number,
  apiMessage: string,
  resetHeader: string | null,
): string {
  if (status === 401) {
    return "Your X connection has expired. Reconnect your X account in Settings.";
  }

  if (status === 403) {
    if (isProgrammaticReplyRestriction(apiMessage)) {
      return "X no longer allows apps to reply to other people's posts (a policy change on 23 Feb 2026 that applies to every self-serve plan). Use Copy, paste the reply into X yourself, then Mark posted. Nothing is wrong with this draft.";
    }

    if (apiMessage.toLowerCase().includes("duplicate")) {
      return `X rejected this post as a duplicate: ${apiMessage} Try different wording.`;
    }

    return `X rejected this post: ${apiMessage}`;
  }

  if (status === 429) {
    const resetAt = parseRateLimitReset(resetHeader);
    return resetAt
      ? `X rate limit reached. Try again after ${resetAt.toISOString()}.`
      : "X rate limit reached. Try again shortly.";
  }

  return apiMessage;
}

// x-rate-limit-reset is unix seconds. Returns null rather than an Invalid
// Date so the caller's message stays sensible when the header is absent.
export function parseRateLimitReset(header: string | null): Date | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}
