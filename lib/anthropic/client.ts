// One place that talks to the Messages API.
//
// Every generator in this app used to open its own `fetch` to
// api.anthropic.com and throw on anything that was not a 200. That is
// fine for the buttons that make one call per press, and it is not fine
// for the Feed sweep, which now runs eight calls at a time: at that width
// a 429 is an ordinary event rather than an emergency, and a sweep that
// treats it as a failure hands back a Feed full of cards that simply have
// no reply, with nothing on screen to say why.
//
// So the retry lives here, below every prompt, and it is the boring kind:
// retry what is worth retrying, wait as long as the server says to wait,
// and give up after a few attempts rather than holding a request open
// forever.

// What deserves another attempt. A 429 is the rate limiter, a 5xx is the
// service having a moment, and both pass. A 400 or a 401 is the request
// itself being wrong, and repeating it just spends the same money twice.
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

// Three attempts total. The sweep's own budget is the reason to stop
// early rather than late: thirty cards each holding a request open for a
// minute of backoff is a page that never renders, and a card without a
// reply is a card the user can still read and answer themselves.
const MAX_ATTEMPTS = 3;

// Doubling from a second, with a cap that keeps the worst case inside the
// route's own timeout.
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

// The server knows how long it wants to be left alone, and says so. Only
// the seconds form is handled: the HTTP-date form is legal and nobody
// sends it here, and a date that fails to parse would otherwise become a
// NaN wait.
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_DELAY_MS);
}

function backoffMs(attempt: number): number {
  // Jittered, because eight lanes that all failed at the same moment
  // would otherwise all come back at the same moment.
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Posts one Messages request and returns the parsed body, or throws.
//
// The error message keeps the status and the response body, because the
// two failures worth telling apart from a log line are "the key is wrong"
// and "the tool schema is wrong", and both only say so in the body.
export async function anthropicMessages(body: unknown): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  let lastError: Error | null = null;
  // What the last failure asked us to wait, when it asked for anything.
  // Null means "use the backoff curve", which is the usual case.
  let lastDelay: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(lastDelay ?? backoffMs(attempt - 1));

    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A dropped connection is the one failure that looks like nothing:
      // no status, no body. It is retried like a 500, because that is
      // usually what it was.
      lastError = error instanceof Error ? error : new Error(String(error));
      lastDelay = null;
      continue;
    }

    if (response.ok) return response.json();

    const errorBody = await response.text().catch(() => "");
    lastError = new Error(
      `Anthropic API responded with ${response.status}: ${errorBody}`,
    );

    if (!isRetryable(response.status)) throw lastError;
    lastDelay = retryAfterMs(response);
  }

  throw lastError ?? new Error("Anthropic API request failed.");
}

// Pulls the tool call out of a response, or returns null. Every generator
// in the app forces one tool and then goes looking for it in the content
// blocks, and every one of them wrote the same type guard to do it.
export function toolInput(data: unknown, name: string): unknown {
  const content: unknown[] = Array.isArray((data as { content?: unknown })?.content)
    ? ((data as { content: unknown[] }).content)
    : [];

  const block = content.find(
    (candidate): candidate is { type: "tool_use"; name: string; input: unknown } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { type?: unknown }).type === "tool_use" &&
      (candidate as { name?: unknown }).name === name,
  );

  return block ? block.input : null;
}
