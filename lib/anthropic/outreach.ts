import type { BrandPackRow } from "@/lib/anthropic/brandPack";

export type OutreachDraftInput = {
  brandPack: BrandPackRow;
  lead: { x_username: string; name: string | null; bio: string | null };
  sourceSnippet: string;
  source: "replied" | "retweeted";
};

const SAVE_OUTREACH_DRAFT_TOOL = {
  name: "save_outreach_draft",
  description: "Save a single outreach reply draft for this lead.",
  input_schema: {
    type: "object",
    properties: {
      draft: {
        type: "string",
        maxLength: 280,
        description:
          "A single reply draft to this lead, under 280 characters, in the founder's voice.",
      },
    },
    required: ["draft"],
  },
} as const;

export function buildOutreachDraftRequest(input: OutreachDraftInput) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system:
      "You are writing a single X (Twitter) outreach reply for a founder, in their own voice, based on their Brand Pack. The recipient is a warm lead who either replied to or retweeted a post the founder engaged with. Reference why they're a good fit and nudge toward the founder's desired next action, without being salesy — it should read like a real person's reply, not ad copy, no hashtags unless the brand voice uses them. The draft MUST fit X's 280-character limit including spaces and punctuation; if it would run long, tighten the wording rather than truncate it.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          positioning: input.brandPack.business_summary,
          icp: input.brandPack.icp,
          voice_notes: input.brandPack.voice_notes,
          reply_templates: input.brandPack.reply_templates,
          lead_handle: input.lead.x_username,
          lead_name: input.lead.name,
          lead_bio: input.lead.bio,
          lead_source: input.source,
          source_tweet_snippet: input.sourceSnippet,
        }),
      },
    ],
    tools: [SAVE_OUTREACH_DRAFT_TOOL],
    tool_choice: { type: "tool", name: "save_outreach_draft" },
  };
}

function isOutreachDraft(input: unknown): input is { draft: string } {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.draft === "string";
}

export async function generateOutreachDraft(input: OutreachDraftInput): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildOutreachDraftRequest(input)),
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
      (block as { name?: unknown }).name === "save_outreach_draft",
  );

  if (!toolUse || !isOutreachDraft(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_outreach_draft tool call.",
    );
  }

  return toolUse.input.draft;
}

export function buildMockOutreachDraft(input: OutreachDraftInput): string {
  const name = input.lead.name ?? `@${input.lead.x_username}`;
  const snippet = input.sourceSnippet.slice(0, 60);
  const voice = (input.brandPack.business_summary ?? "your brand").slice(0, 40);
  const verb = input.source === "replied" ? "replied to" : "retweeted";

  return `[Mock draft for @${input.lead.x_username}] Hey ${name} — saw you ${verb} "${snippet}". Set ANTHROPIC_API_KEY to generate a real outreach draft in the voice of "${voice}".`;
}
