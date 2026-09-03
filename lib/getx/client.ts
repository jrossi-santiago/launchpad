export function getBaseUrl(): string {
  return process.env.GETX_API_BASE_URL ?? "https://api.getxapi.com";
}

export function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.GETX_API_KEY!}`,
    "content-type": "application/json",
  };
}

// Reads a fetch Response body once, as JSON if possible, falling back to
// text. Used by every GetXAPI call site so an error path never double-reads
// the body stream.
export async function readBody(response: Response): Promise<unknown> {
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
export function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string") {
    return (body as Record<string, unknown>).error as string;
  }
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  return `GetXAPI request failed with status ${status}.`;
}
