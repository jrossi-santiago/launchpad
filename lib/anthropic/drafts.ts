import type { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";

export type TweetForDrafts = {
  author_handle: string | null;
  content: string | null;
};

export type DraftRow = {
  id: string;
  tweet_id: string;
  user_id: string;
  variant: number;
  draft_text: string | null;
  status: string;
  created_at: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const GROK_HANDLE = "@grok";
export const GROK_VARIANT = 3;

const SAVE_DRAFTS_TOOL = {
  name: "save_drafts",
  description:
    "Save 2 reply drafts plus 1 question addressed to @grok for this tweet.",
  input_schema: {
    type: "object",
    properties: {
      replies: {
        type: "array",
        items: { type: "string", maxLength: 280 },
        minItems: 2,
        maxItems: 2,
        description:
          "2 distinct reply drafts in the founder's voice, each under 280 characters.",
      },
      grok_question: {
        type: "string",
        maxLength: 280,
        description:
          "A reply that tags @grok and asks it one genuine question about the tweet's subject. Under 280 characters including the @grok tag.",
      },
    },
    required: ["replies", "grok_question"],
  },
} as const;

const SYSTEM_PROMPT = [
  "You are writing X (Twitter) reply drafts for a founder, in their own voice, based on their Brand Pack.",
  "Each draft must read like something a real person would type as a quick reply — not ad copy, no hashtags unless the brand voice uses them.",
  "Every draft MUST fit X's 280-character limit including spaces and punctuation; if a draft would run long, tighten the wording rather than truncate it.",
  "",
  "The two `replies` are ordinary replies to the tweet.",
  "",
  "`grok_question` is different: it is a reply that tags @grok and asks it one real question, so that Grok answers publicly in the thread.",
  "Rules for `grok_question`:",
  "- It must start with @grok.",
  "- Ask exactly one genuine, answerable question and end it with a question mark. No rhetorical questions, no multi-part questions.",
  "- Anchor it in both the subject of the tweet and the territory the Brand Pack says this founder wants to be known for, so the answer is worth reading for their ideal customer.",
  "- Never ask something the tweet already answers.",
  "- No pitch, no plug, no mention of the founder's product.",
  "- Keep it short: just enough context for the question to stand on its own, then the question. Stay in the founder's voice and respect their voice guardrails.",
].join("\n");

export function buildDraftsRequest(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          positioning: brandPack.business_summary,
          icp: brandPack.icp,
          voice_notes: brandPack.voice_notes,
          reply_templates: brandPack.reply_templates,
          tweet_author: tweet.author_handle,
          tweet_text: tweet.content,
        }),
      },
    ],
    tools: [SAVE_DRAFTS_TOOL],
    tool_choice: { type: "tool", name: "save_drafts" },
  };
}

type DraftsToolInput = { replies: string[]; grok_question: string };

function isDraftsToolInput(input: unknown): input is DraftsToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    Array.isArray(value.replies) &&
    value.replies.length === 2 &&
    value.replies.every((d) => typeof d === "string") &&
    typeof value.grok_question === "string"
  );
}

export function isValidGrokQuestion(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 280 &&
    trimmed.toLowerCase().startsWith(GROK_HANDLE) &&
    trimmed.endsWith("?")
  );
}

async function requestDrafts(body: unknown): Promise<DraftsToolInput> {
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
      (block as { name?: unknown }).name === "save_drafts",
  );

  if (!toolUse || !isDraftsToolInput(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_drafts tool call.",
    );
  }

  return toolUse.input;
}

export async function callHaiku(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): Promise<string[]> {
  const request = buildDraftsRequest(brandPack, tweet);
  let result = await requestDrafts(request);

  if (!isValidGrokQuestion(result.grok_question)) {
    // One corrective retry rather than shipping a third option that Grok
    // will never answer.
    result = await requestDrafts({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous grok_question: ${result.grok_question}`,
        },
        {
          role: "user",
          content:
            "That grok_question was not usable. Rewrite all three drafts. The grok_question MUST start with @grok, must end with a question mark, must ask exactly one genuine question, and must be 280 characters or fewer.",
        },
      ],
    });
  }

  return [...result.replies, result.grok_question.trim()];
}

export function buildMockDrafts(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): string[] {
  const author = tweet.author_handle ?? "them";
  const snippet = (tweet.content ?? "").slice(0, 60);

  return [
    `[Mock draft 1] Replying to ${author} — set ANTHROPIC_API_KEY to generate real, on-voice drafts.`,
    `[Mock draft 2] re: "${snippet}" — this is a placeholder until ANTHROPIC_API_KEY is set.`,
    `${GROK_HANDLE} [Mock draft 3] what's the strongest evidence either way on this? Placeholder until ANTHROPIC_API_KEY is set.`,
  ];
}

export async function insertDrafts(
  supabase: SupabaseServerClient,
  userId: string,
  tweetId: string,
  drafts: string[],
): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from("drafts")
    .insert(
      drafts.map((draft_text, i) => ({
        tweet_id: tweetId,
        user_id: userId,
        variant: i + 1,
        draft_text,
        status: "draft",
      })),
    )
    .select();

  if (error) throw error;
  return data as DraftRow[];
}
