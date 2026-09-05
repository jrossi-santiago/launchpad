import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { POST_MAX } from "@/lib/scheduler/posts";

// Sharpen, not write.
//
// Every other generator in this app is handed someone else's post and
// asked to produce a comment. This one is handed the founder's own words
// and asked to give them back better — same claim, same point, same
// voice, fewer words. That is a deliberate limit: a post the model
// invented is a post nobody can defend in the replies, and the founder
// asked for sharpen first for exactly that reason.
//
// So the rules below are mostly prohibitions. The model may cut, reorder
// and tighten. It may not add a fact, a number, or an opinion that was
// not in the input.
export const SHARPEN_MODEL = "claude-haiku-4-5-20251001";

export type SharpenedPost = {
  text: string;
  // What was changed, in one line, shown under the suggestion. The
  // founder is choosing between their draft and this one, and "shorter"
  // is not enough information to choose on.
  changed: string;
};

const SAVE_POST_TOOL = {
  name: "save_post",
  description: "Save the sharpened version of the founder's post.",
  input_schema: {
    type: "object",
    properties: {
      changed: {
        type: "string",
        description:
          "One short sentence — under 15 words — saying what you changed and why. Written to the founder.",
      },
      post: {
        type: "string",
        maxLength: POST_MAX,
        description: `The sharpened post, ${POST_MAX} characters or fewer including spaces. The founder's claim, in the founder's voice.`,
      },
    },
    required: ["changed", "post"],
  },
} as const;

const SYSTEM_PROMPT = [
  "You are sharpening a founder's own X (Twitter) post. They wrote it. You are giving it back tighter.",
  "",
  "What you may do:",
  "- Cut every word that is not doing work. Most drafts lose 20-30% and say more.",
  "- Lead with the most specific thing in the draft. If there is a number, a price or a result buried in the third line, it belongs in the first.",
  "- Break one long sentence into two short ones where that lands harder.",
  "- Fix a line that is trying to say two things at once by picking the better one.",
  "",
  "What you must not do:",
  "- Do not add a fact, a number, a result or a claim that is not in the draft. If the draft has no number, the sharpened version has no number. Inventing one is the single worst thing you can do here — it is the founder's account and their reputation on the line.",
  "- Do not change what they are claiming, or soften it into something safer.",
  "- Do not add hashtags, emoji, or a call to action that is not already there.",
  "- Do not open with a hook formula — no 'Most people think', no 'Here's the thing', no 'Unpopular opinion', no single-word opener on its own line.",
  "- Do not end with a lesson, a summary, or a question the draft did not ask.",
  "- Do not make it sound like marketing. It should read like the founder typed it on their phone and happened to be having a good day.",
  "",
  "The brand pack is there so you keep their voice and respect their guardrails, not so you can steer the post towards their product. If the draft is not about what they sell, the sharpened version is not either.",
  `Hard limit: ${POST_MAX} characters including spaces.`,
].join("\n");

export function buildSharpenRequest(brandPack: BrandPackRow, draft: string) {
  return {
    model: SHARPEN_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          // Voice only, for the same reason lib/anthropic/drafts.ts
          // keeps the ICP out of a reply request: positioning in the
          // context is positioning in the output, and this post is
          // whatever the founder decided it is about.
          voice_notes: brandPack.voice_notes,
          voice_samples: brandPack.reply_templates,
          draft,
        }),
      },
    ],
    tools: [SAVE_POST_TOOL],
    tool_choice: { type: "tool", name: "save_post" },
  };
}

async function post(body: unknown): Promise<unknown> {
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
    throw new Error(`Anthropic API responded with ${response.status}: ${errorBody}`);
  }

  return response.json();
}

function parse(payload: unknown): SharpenedPost | null {
  const content = (payload as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;

  const toolUse = content.find(
    (block) => (block as { type?: unknown })?.type === "tool_use",
  ) as { input?: Record<string, unknown> } | undefined;

  const input = toolUse?.input;
  if (!input || typeof input.post !== "string") return null;

  const text = input.post.trim();
  // A sharpened post over the limit is not a suggestion, it is a post
  // that cannot be sent. Rejected here rather than shown and refused
  // later by the composer.
  if (!text || text.length > POST_MAX) return null;

  return {
    text,
    changed:
      typeof input.changed === "string" && input.changed.trim()
        ? input.changed.trim()
        : "Tightened.",
  };
}

export async function sharpenPost(
  brandPack: BrandPackRow,
  draft: string,
): Promise<SharpenedPost> {
  const payload = await post(buildSharpenRequest(brandPack, draft));
  const result = parse(payload);

  if (result) return result;

  // One corrective retry, the same as the drafts and @grok paths: the
  // only failure a regex can catch here is length, and running long is
  // the model's most likely miss.
  const retry = await post({
    ...buildSharpenRequest(brandPack, draft),
    system: `${SYSTEM_PROMPT}\n\nYour last attempt was rejected. It ran over ${POST_MAX} characters or came back empty. Cut it down and answer again.`,
  });

  const second = parse(retry);
  if (second) return second;

  throw new Error("Could not sharpen that post.");
}

// The keyless path, so the whole app stays runnable with no
// ANTHROPIC_API_KEY set — same convention as buildMockDrafts() and the
// mock HeatCheck read.
export function buildMockSharpen(draft: string): SharpenedPost {
  const trimmed = draft.trim().replace(/\s+/g, " ");

  return {
    text: trimmed.slice(0, POST_MAX),
    changed: "[Mock] Set ANTHROPIC_API_KEY to have Haiku sharpen this for real.",
  };
}
