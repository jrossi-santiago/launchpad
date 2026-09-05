// X's own reply composer, pre-filled. Opening this is an ordinary link a
// person then presses Post on — it is not the API reply X restricted for
// self-serve apps on 23 Feb 2026.
//
// On a phone the same URL is claimed by the installed X app, so this opens
// the native composer rather than a browser tab. The `text` parameter is
// best-effort: every caller copies the draft to the clipboard first, so if
// X ever stops honouring it the flow degrades to a paste instead of
// breaking.
export function replyIntentUrl(xTweetId: string, text: string): string {
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("in_reply_to", xTweetId);
  url.searchParams.set("text", text);
  return url.toString();
}

// Copy and open, in that order, without awaiting the copy.
//
// Awaiting the clipboard write first would end the user-gesture context
// and mobile Safari would swallow the new tab as a popup. Starting the
// copy and opening synchronously keeps both: the tab always opens, and the
// clipboard lands a moment later.
export function copyAndOpenReply(xTweetId: string, text: string): void {
  if (!text) return;
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  window.open(replyIntentUrl(xTweetId, text), "_blank", "noopener,noreferrer");
}
