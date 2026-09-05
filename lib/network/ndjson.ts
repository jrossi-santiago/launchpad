// Reading a newline-delimited JSON response, one event at a time.
//
// The Feed's Reload streams its work rather than returning it in one
// piece, and the only genuinely fiddly part of receiving that is the part
// that has nothing to do with the Feed: a network chunk ends where the
// network decides it ends, which is regularly halfway through an object.
// So the tail after the last newline is not an event, it is the start of
// the next one, and it has to survive until the rest of it turns up.
//
// It lives here rather than inside the component for that reason — it is
// the piece worth being sure about, and it is impossible to be sure about
// anything buried in a click handler.

// Calls `onEvent` for each complete line, in order, as it arrives.
// Malformed lines throw, which is the honest answer: the stream is
// written by the route next door, so a line that will not parse means
// something is wrong that a caller should hear about rather than a
// message we can quietly skip.
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    // `stream: true` is what keeps a multi-byte character split across
    // two chunks from being decoded as two broken ones.
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    // Whatever follows the last newline is incomplete by definition.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as T);
    }
  }

  // A stream that ends without a trailing newline still ended with an
  // event.
  buffer += decoder.decode();
  if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
}
