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

const SAVE_DRAFTS_TOOL = {
  name: "save_drafts",
  description: "Save exactly 3 reply drafts for this tweet.",
  input_schema: {
    type: "object",
    properties: {
      drafts: {
        type: "array",
        items: { type: "string", maxLength: 280 },
        minItems: 3,
        maxItems: 3,
        description: "3 distinct reply drafts, each under 280 characters.",
      },
    },
    required: ["drafts"],
  },
} as const;

export function buildDraftsRequest(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "You are writing X (Twitter) reply drafts for a founder, in their own voice, based on their Brand Pack. Each draft must read like something a real person would type as a quick reply — not ad copy, no hashtags unless the brand voice uses them. Every draft MUST fit X's 280-character limit including spaces and punctuation; if a draft would run long, tighten the wording rather than truncate it.",
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

function isThreeDrafts(input: unknown): input is { drafts: string[] } {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    Array.isArray(value.drafts) &&
    value.drafts.length === 3 &&
    value.drafts.every((d) => typeof d === "string")
  );
}

export async function callHaiku(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): Promise<string[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildDraftsRequest(brandPack, tweet)),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API responded with ${response.status}: ${body}`);
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

  if (!toolUse || !isThreeDrafts(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_drafts tool call.",
    );
  }

  return toolUse.input.drafts;
}

export function buildMockDrafts(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): string[] {
  const author = tweet.author_handle ?? "them";
  const snippet = (tweet.content ?? "").slice(0, 60);
  const voice = (brandPack.business_summary ?? "your brand").slice(0, 40);

  return [
    `[Mock draft 1] Replying to ${author} — set ANTHROPIC_API_KEY to generate real, on-voice drafts.`,
    `[Mock draft 2] re: "${snippet}" — this is a placeholder until ANTHROPIC_API_KEY is set.`,
    `[Mock draft 3] Placeholder reply in the voice of "${voice}".`,
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
