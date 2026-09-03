export type XTestConnectionResult = { handle: string };
export type XPostReplyResult = { postedTweetId: string };

function getBaseUrl(): string {
  return process.env.GETX_API_BASE_URL ?? "https://api.getxapi.com";
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.GETX_API_KEY!}`,
    "content-type": "application/json",
  };
}

// Reads a fetch Response body once, as JSON if possible, falling back to
// text. Used by both call sites below so an error path never double-reads
// the body stream.
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

// GetXAPI's error responses across this endpoint family are consistently
// { error: string, twitter_error_code?: number } — verified against
// GetXAPI's own documented error responses for /twitter/tweet/create.
// Never includes authToken/ct0: the caller only ever passes us the parsed
// response body, never the request credentials.
function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string") {
    return (body as Record<string, unknown>).error as string;
  }
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  return `GetXAPI request failed with status ${status}.`;
}

// UNVERIFIED CONTRACT — see Lesson 3 / AGENTS.md. No GetXAPI documentation
// for a "resolve login cookies to a handle" endpoint was available when
// this was written (only tweet/create, tweet/replies, and tweet/thread were
// documented). This guesses an endpoint modeled on Twitter's own classic
// `account/verify_credentials` naming and GetXAPI's tweet/detail envelope
// shape ({ status, msg, data }). Every assumption about path, request
// shape, and response envelope lives in this one function — if the real
// endpoint differs, this is a one-function fix; nothing else in the app
// depends on the guessed shape directly.
export async function testXConnection(
  authToken: string,
  ct0: string,
): Promise<XTestConnectionResult> {
  const response = await fetch(`${getBaseUrl()}/twitter/user/verify_credentials`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_token: authToken, ct0 }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXTestConnectionResponse(body);
}

// Isolates the guessed response-envelope shape (see testXConnection above)
// so a wrong guess about the field names is a one-function fix.
export function mapGetXTestConnectionResponse(response: unknown): XTestConnectionResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI connection check returned an unexpected response.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : envelope;

  const userName = (data as Record<string, unknown>).userName ?? (data as Record<string, unknown>).username;

  if (typeof userName !== "string" || !userName) {
    throw new Error("GetXAPI connection check did not return an account handle.");
  }

  return { handle: userName };
}

// VERIFIED CONTRACT — POST /twitter/tweet/create, confirmed against
// GetXAPI's published documentation. Success is a 200 with
// { status: "success", msg, data: { id, text, createdAt, ... } }; failures
// use varied HTTP statuses (400/401/409/403/429/502/503) but a consistent
// { error: string, twitter_error_code?: number } body.
export async function postReply(
  authToken: string,
  ct0: string,
  replyToTweetId: string,
  text: string,
): Promise<XPostReplyResult> {
  const response = await fetch(`${getBaseUrl()}/twitter/tweet/create`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      auth_token: authToken,
      ct0,
      text,
      reply_to_tweet_id: replyToTweetId,
    }),
  });

  const body = await readBody(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }

  return mapGetXPostReplyResponse(body);
}

// Isolates the verified /twitter/tweet/create success envelope.
export function mapGetXPostReplyResponse(response: unknown): XPostReplyResult {
  if (!response || typeof response !== "object") {
    throw new Error("GetXAPI did not return a valid response for the reply.");
  }

  const envelope = response as Record<string, unknown>;
  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;

  const id = data?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("GetXAPI did not return a tweet id for the posted reply.");
  }

  return { postedTweetId: id };
}

// Deterministic — returns a fixed mock handle whenever both authToken and
// ct0 are non-empty strings. The non-emptiness check itself happens in the
// route, not here.
export function buildMockTestConnection(): XTestConnectionResult {
  return { handle: "mock_connected_user" };
}

// Deterministic — no Math.random(), built from a fixed prefix + the tweet
// being replied to so repeated mock posts to different tweets don't
// collide.
export function buildMockPostReply(replyToTweetId: string): XPostReplyResult {
  return { postedTweetId: `mock-posted-${replyToTweetId}` };
}
