import type { createClient } from "@/lib/supabase/server";

export type InterviewAnswers = {
  what_you_sell: string;
  who_its_for: string;
  desired_next_action: string;
  example_posts: string[];
  never_say: string;
};

export type BrandPackFields = {
  positioning: string;
  icp_bullets: string[];
  voice_notes: string;
  reply_templates: string[];
};

export type BrandPackRow = {
  id: string;
  user_id: string;
  business_summary: string | null;
  icp: string | null;
  voice_notes: string | null;
  raw_interview: InterviewAnswers | null;
  reply_templates: string[];
  created_at: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const SAVE_BRAND_PACK_TOOL = {
  name: "save_brand_pack",
  description:
    "Save the structured Brand Pack derived from the founder's interview answers.",
  input_schema: {
    type: "object",
    properties: {
      positioning: {
        type: "string",
        description:
          "One paragraph describing what they sell and who it's for.",
      },
      icp_bullets: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "Specific, targetable descriptions of their ideal customer.",
      },
      voice_notes: {
        type: "string",
        description:
          "Tone and topic guardrails, explicitly incorporating what they said they never say.",
      },
      reply_templates: {
        type: "array",
        items: { type: "string" },
        minItems: 8,
        maxItems: 8,
        description:
          "8 short reply drafts (1-2 sentences) they could adapt when replying to posts in their niche, matching their voice.",
      },
    },
    required: ["positioning", "icp_bullets", "voice_notes", "reply_templates"],
  },
} as const;

export function buildBrandPackRequest(answers: InterviewAnswers) {
  return {
    model: "claude-sonnet-5",
    max_tokens: 2048,
    temperature: 0.7,
    system:
      "You are helping a founder build a Brand Pack for Launchpad, a tool that finds high-engagement X posts in their niche and helps them reply in their own voice. Given their interview answers, produce a positioning statement, an ideal customer profile, voice guardrails, and reply templates they can adapt. Keep everything concrete and specific to what they told you — no generic marketing filler. Reply templates should read like something a real person would actually post, not ad copy.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          what_you_sell: answers.what_you_sell,
          who_its_for: answers.who_its_for,
          desired_next_action: answers.desired_next_action,
          example_posts: answers.example_posts,
          never_say: answers.never_say,
        }),
      },
    ],
    tools: [SAVE_BRAND_PACK_TOOL],
    tool_choice: { type: "tool", name: "save_brand_pack" },
  };
}

function isBrandPackFields(input: unknown): input is BrandPackFields {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.positioning === "string" &&
    Array.isArray(value.icp_bullets) &&
    value.icp_bullets.every((bullet) => typeof bullet === "string") &&
    typeof value.voice_notes === "string" &&
    Array.isArray(value.reply_templates) &&
    value.reply_templates.length === 8 &&
    value.reply_templates.every((template) => typeof template === "string")
  );
}

export async function callClaude(
  answers: InterviewAnswers,
): Promise<BrandPackFields> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildBrandPackRequest(answers)),
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
      (block as { name?: unknown }).name === "save_brand_pack",
  );

  if (!toolUse || !isBrandPackFields(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_brand_pack tool call.",
    );
  }

  return toolUse.input;
}

export function buildMockBrandPack(answers: InterviewAnswers): BrandPackFields {
  return {
    positioning: `You sell ${answers.what_you_sell} to ${answers.who_its_for}. When someone responds well, the goal is for them to ${answers.desired_next_action}.`,
    icp_bullets: [
      `Interested in or actively discussing: ${answers.who_its_for}`,
      `Posts or engages with content similar to: "${answers.example_posts[0]?.slice(0, 80) ?? "example post"}"`,
    ],
    voice_notes: `Avoid: ${answers.never_say}`,
    reply_templates: Array.from(
      { length: 8 },
      (_, i) =>
        `[Mock reply template ${i + 1}] Related to "${answers.what_you_sell}" — replace ANTHROPIC_API_KEY to generate real ones.`,
    ),
  };
}

export async function upsertBrandPack(
  supabase: SupabaseServerClient,
  userId: string,
  fields: BrandPackFields,
  rawInterview?: InterviewAnswers,
): Promise<BrandPackRow> {
  const { data: existing, error: lookupError } = await supabase
    .from("brand_packs")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const payload: Record<string, unknown> = {
    business_summary: fields.positioning,
    icp: fields.icp_bullets.join("\n"),
    voice_notes: fields.voice_notes,
    reply_templates: fields.reply_templates,
  };

  if (rawInterview) {
    payload.raw_interview = rawInterview;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("brand_packs")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return data as BrandPackRow;
  }

  const { data, error } = await supabase
    .from("brand_packs")
    .insert({ user_id: userId, ...payload })
    .select()
    .single();

  if (error) throw error;
  return data as BrandPackRow;
}
