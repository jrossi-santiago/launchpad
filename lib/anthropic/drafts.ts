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

const SAVE_REPLIES_TOOL = {
  name: "save_replies",
  description: "Save 2 reply drafts for this tweet.",
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
    },
    required: ["replies"],
  },
} as const;

const SAVE_GROK_TOOL = {
  name: "save_grok_question",
  description: "Save 1 question addressed to @grok about this tweet.",
  input_schema: {
    type: "object",
    properties: {
      grok_question: {
        type: "string",
        maxLength: 280,
        description:
          "A reply that tags @grok and asks it one genuine question about the tweet's subject. Under 280 characters including the @grok tag.",
      },
    },
    required: ["grok_question"],
  },
} as const;

// Two prompts, because they need two different things in front of them.
//
// The replies are ordinary replies, and the Feed learned the hard way
// what happens when the founder's positioning and ICP are in context for
// one of those: the model treats them as the job and every draft comes
// out with a slant. So the replies request carries the voice half of the
// Brand Pack and nothing else — there is no territory in the request to
// steer towards.
//
// The @grok question is the exception that proves it. Its whole purpose
// is to get Grok answering publicly on the ground this founder wants to
// be known for, so it needs the agenda and is asked for on its own.
const REPLIES_PROMPT = [
  "You are writing X (Twitter) reply drafts for a founder, in their own voice, based on their Brand Pack.",
  "Each draft must read like something a real person would type as a quick reply — not ad copy, no hashtags unless the brand voice uses them.",
  "Every draft MUST fit X's 280-character limit including spaces and punctuation; if a draft would run long, tighten the wording rather than truncate it.",
  "",
  "Write as someone who knows this world well and enjoys talking about it — a person joining the conversation, not an expert marking the post. Pick the bit that actually caught your eye, and bring something of your own: what happened when you tried it, the case that went differently, the thing you have wondered about since. Curiosity beats correction: if you see it differently, say so as your own read, not as a fix. A real question is a good reply when you actually want the answer.",
  "Do not sound like a know-it-all repeating the post back. Never restate or summarise what they just said before adding your bit — start at your bit. No verdicts on the post ('great point', 'this is so true', 'exactly right', 'underrated take'). No lecturing, no opening with 'Actually', no lesson tacked on the end, no credentials. Never write a reply that would fit any other tweet.",
  "",
  "These replies are not going anywhere. You are in the thread because the subject is interesting, and that is the entire reason — no pitch, no plug, no mention of the founder's product, and no working round to what they do for a living.",
  "The two drafts must be genuinely different takes, not one idea worded twice.",
].join("\n");

const GROK_PROMPT = [
  "You are writing one X (Twitter) reply for a founder, in their own voice, based on their Brand Pack.",
  "It is a reply that tags @grok and asks it one real question, so that Grok answers publicly in the thread.",
  "Rules:",
  "- It must start with @grok.",
  "- Ask exactly one genuine, answerable question and end it with a question mark. No rhetorical questions, no multi-part questions.",
  "- Anchor it in both the subject of the tweet and the territory the Brand Pack says this founder wants to be known for, so the answer is worth reading for their ideal customer.",
  "- Ask it the way someone genuinely curious would — the thing you actually want to know — not the way an examiner would test whether Grok knows it.",
  "- Never ask something the tweet already answers.",
  "- No pitch, no plug, no mention of the founder's product.",
  "- Keep it short: just enough context for the question to stand on its own, then the question. Stay in the founder's voice and respect their voice guardrails.",
  "- It MUST fit 280 characters including the @grok tag.",
].join("\n");

export function buildRepliesRequest(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: REPLIES_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          // Voice only. Positioning and ICP are deliberately absent —
          // their keys too, since a model shown `icp: null` still knows
          // an ICP is a thing it is meant to have.
          voice_notes: brandPack.voice_notes,
          voice_samples: brandPack.reply_templates,
          tweet_author: tweet.author_handle,
          tweet_text: tweet.content,
        }),
      },
    ],
    tools: [SAVE_REPLIES_TOOL],
    tool_choice: { type: "tool", name: "save_replies" },
  };
}

export function buildGrokRequest(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: GROK_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          positioning: brandPack.business_summary,
          icp: brandPack.icp,
          voice_notes: brandPack.voice_notes,
          tweet_author: tweet.author_handle,
          tweet_text: tweet.content,
        }),
      },
    ],
    tools: [SAVE_GROK_TOOL],
    tool_choice: { type: "tool", name: "save_grok_question" },
  };
}

function toolInput(data: unknown, name: string): Record<string, unknown> {
  const content: unknown[] = Array.isArray((data as { content?: unknown })?.content)
    ? ((data as { content: unknown[] }).content)
    : [];
  const toolUse = content.find(
    (block): block is { type: "tool_use"; name: string; input: unknown } =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "tool_use" &&
      (block as { name?: unknown }).name === name,
  );

  if (!toolUse || !toolUse.input || typeof toolUse.input !== "object") {
    throw new Error(`Anthropic response did not include a valid ${name} tool call.`);
  }

  return toolUse.input as Record<string, unknown>;
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
    throw new Error(
      `Anthropic API responded with ${response.status}: ${errorBody}`,
    );
  }

  return response.json();
}

async function requestReplies(brandPack: BrandPackRow, tweet: TweetForDrafts) {
  const input = toolInput(
    await post(buildRepliesRequest(brandPack, tweet)),
    "save_replies",
  );
  const replies = input.replies;
  if (
    !Array.isArray(replies) ||
    replies.length !== 2 ||
    !replies.every((reply) => typeof reply === "string")
  ) {
    throw new Error("Anthropic response did not include two usable replies.");
  }
  return replies as string[];
}

async function requestGrok(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): Promise<string> {
  const request = buildGrokRequest(brandPack, tweet);
  const first = toolInput(await post(request), "save_grok_question");
  const question =
    typeof first.grok_question === "string" ? first.grok_question : "";

  if (isValidGrokQuestion(question)) return question.trim();

  // One corrective retry rather than shipping a question Grok will never
  // answer. Only this half is retried — the replies are judged on nothing
  // a regex can check.
  const second = toolInput(
    await post({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: `Previous grok_question: ${question}` },
        {
          role: "user",
          content:
            "That grok_question was not usable. Rewrite it. It MUST start with @grok, must end with a question mark, must ask exactly one genuine question, and must be 280 characters or fewer.",
        },
      ],
    }),
    "save_grok_question",
  );

  return typeof second.grok_question === "string"
    ? second.grok_question.trim()
    : question.trim();
}

// The two calls run together: they need different context, not different
// timing, and one round trip of latency is what the sheet can afford.
export async function callHaiku(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): Promise<string[]> {
  const [replies, grokQuestion] = await Promise.all([
    requestReplies(brandPack, tweet),
    requestGrok(brandPack, tweet),
  ]);

  return [...replies, grokQuestion];
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
