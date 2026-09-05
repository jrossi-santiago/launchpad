import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { QuotedPost } from "@/lib/getx/userTweets";

// One reply, written for one post, for the Feed's Reload button.
//
// This is deliberately not lib/anthropic/drafts.ts. That module writes the
// three options you pick between once you have decided to reply to a post
// — two replies plus a @grok question — and it costs a queue row to get
// them. Reload is the other direction: it writes a single ready reply for
// every fresh post so the Feed arrives already answerable, and it does so
// for many posts at once, which makes both the prompt and the budget
// different. What they share is the Brand Pack and the 280-character
// ceiling.

export type ReplyTarget = {
  handle: string;
  display_name: string | null;
  content: string | null;
  quoted: QuotedPost | null;
};

const SAVE_REPLY_TOOL = {
  name: "save_reply",
  description: "Save one reply to this specific post, in the founder's voice.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        maxLength: 280,
        description:
          "The reply. Under 280 characters, and specific to this post's actual content.",
      },
      hook: {
        type: "string",
        description:
          "The exact phrase, claim, number or detail from the post that the reply answers. Quoted from the post, not paraphrased.",
      },
    },
    required: ["reply", "hook"],
  },
} as const;

// The `hook` field is the whole anti-generic mechanism: asking for the
// phrase being answered, in the same tool call, forces the model to find
// one before it writes. A reply whose hook does not appear in the post is
// a reply that could have been written without reading it, and that is
// exactly the reply this feature exists to avoid — so it is rejected and
// asked for again.
const SYSTEM_PROMPT = [
  "You write X (Twitter) replies for a founder, in their own voice, from their Brand Pack.",
  "You are given one post. Write one reply to that post.",
  "",
  "The reply must be about THIS post. Specifically:",
  "- Answer, extend, push back on, or add evidence to a particular thing the post says.",
  "- Quote or name the specific detail you are responding to in `hook` — the phrase, claim, number, or example, taken from the post's own words.",
  "- If the post quotes another post, the reply may respond to either, but it must be about what was actually said.",
  "",
  "Never write a reply that would fit any other post: no 'great thread', no 'this is so true', no 'love this take', no restating the post back at them, no generic praise or agreement.",
  "Never pitch the founder's product, never link, no hashtags unless the brand voice uses them.",
  "Add something the author or a reader gains from: a concrete example, a counterpoint, a number, a lived detail, or a real question.",
  "",
  "It must read like a person typing a quick reply on their phone. One or two sentences. Lowercase is fine if the voice notes suggest it.",
  "It MUST fit 280 characters including spaces and punctuation — tighten the wording rather than truncate.",
  "The founder's voice guardrails ('never say') override everything above.",
].join("\n");

export function buildFeedReplyRequest(
  brandPack: BrandPackRow,
  target: ReplyTarget,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          positioning: brandPack.business_summary,
          icp: brandPack.icp,
          voice_notes: brandPack.voice_notes,
          // The templates are shown to the model as voice samples, not as
          // text to reuse: a Reload that handed back a template would be
          // the generic reply this feature replaces.
          voice_samples: brandPack.reply_templates,
          post: {
            author: `@${target.handle}`,
            author_name: target.display_name,
            text: target.content,
            quoting: target.quoted
              ? { author: `@${target.quoted.handle}`, text: target.quoted.text }
              : null,
          },
        }),
      },
    ],
    tools: [SAVE_REPLY_TOOL],
    tool_choice: { type: "tool", name: "save_reply" },
  };
}

type ReplyToolInput = { reply: string; hook: string };

function isReplyToolInput(input: unknown): input is ReplyToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.reply === "string" && typeof value.hook === "string";
}

// Normalised containment: the model quotes the post's words but not always
// its punctuation or casing, and X text is full of curly quotes and
// non-breaking spaces that would fail a literal indexOf.
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

// True when the hook is really drawn from the post. Short hooks are the
// interesting failure — a one-word hook ("this") is satisfied by almost
// any post — so they are held to the same containment test but must carry
// at least a couple of words to count as evidence of reading.
export function isGroundedReply(
  reply: string,
  hook: string,
  postText: string,
): boolean {
  const trimmed = reply.trim();
  if (trimmed.length === 0 || trimmed.length > 280) return false;

  const haystack = normalise(postText);
  const needle = normalise(hook);
  if (!haystack || !needle) return false;
  if (needle.split(" ").length < 2) return false;

  return haystack.includes(needle);
}

async function requestReply(body: unknown): Promise<ReplyToolInput> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API responded with ${response.status}: ${errorBody}`,
    );
  }

  const data = await response.json();
  const content: unknown[] = Array.isArray(data?.content) ? data.content : [];
  const toolUse = content.find(
    (block): block is { type: "tool_use"; name: string; input: unknown } =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "tool_use" &&
      (block as { name?: unknown }).name === "save_reply",
  );

  if (!toolUse || !isReplyToolInput(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_reply tool call.",
    );
  }

  return toolUse.input;
}

// Returns the reply text, or throws. One corrective retry when the first
// attempt is not anchored in the post — the same shape of retry the drafts
// module makes for an unusable @grok question.
export async function callHaikuFeedReply(
  brandPack: BrandPackRow,
  target: ReplyTarget,
): Promise<string> {
  const postText = [target.content ?? "", target.quoted?.text ?? ""].join(" ");
  const request = buildFeedReplyRequest(brandPack, target);
  let result = await requestReply(request);

  if (!isGroundedReply(result.reply, result.hook, postText)) {
    result = await requestReply({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous reply: ${result.reply}\nPrevious hook: ${result.hook}`,
        },
        {
          role: "user",
          content:
            "That reply was not anchored in the post. Rewrite it. Pick a specific phrase that appears in the post's own text, put that phrase in `hook` word for word, and make the reply respond to it. Stay under 280 characters.",
        },
      ],
    });
  }

  const reply = result.reply.trim();
  if (!reply || reply.length > 280) {
    throw new Error("Model returned an unusable reply.");
  }

  return reply;
}

// Without an API key, still say something about this post rather than
// nothing — a mock that ignored the post would hide the one bug this
// feature can have.
export function buildMockFeedReply(target: ReplyTarget): string {
  const snippet = (target.content ?? "").trim().slice(0, 80);
  return `[Mock reply to @${target.handle}] re: "${snippet}" — set ANTHROPIC_API_KEY to have Haiku read this post and write a real reply.`;
}
