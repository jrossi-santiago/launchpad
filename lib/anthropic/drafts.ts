import type { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  BREVITY_RULES,
  COMMENT_MAX,
  CTA_FIELD,
  CTA_RULES,
  POINT_FIELD,
  cleanCta,
  isUsableComment,
} from "@/lib/anthropic/comment";

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
  // The ask that may be appended to this draft, written as its own line
  // and stored as its own column. Null on the @grok draft always, and on
  // a reply draft with nothing honest to offer.
  draft_cta: string | null;
  status: string;
  created_at: string;
};

// One draft on its way to the database: the comment, and the optional
// line the founder may put under it.
export type WrittenDraft = {
  text: string;
  cta: string | null;
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
        items: {
          type: "object",
          properties: {
            point: POINT_FIELD,
            reply: {
              type: "string",
              maxLength: COMMENT_MAX,
              description: `The draft, in the founder's voice, ${COMMENT_MAX} characters or fewer. One sentence, two only if the second is a question.`,
            },
            cta: CTA_FIELD,
          },
          required: ["point", "reply", "cta"],
        },
        minItems: 2,
        maxItems: 2,
        description:
          "2 distinct reply drafts in the founder's voice, each naming its own point first.",
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
  ...BREVITY_RULES,
  "Each draft names its own `point` before it is written, and the two points must be different things — that is what makes the drafts genuinely different rather than one idea worded twice.",
  "",
  "Write as someone who knows this world well and enjoys talking about it — a person joining the conversation, not an expert marking the post. Pick the bit that actually caught your eye, and bring something of your own: what happened when you tried it, the case that went differently, the thing you have wondered about since. Curiosity beats correction: if you see it differently, say so as your own read, not as a fix. A real question is a good reply when you actually want the answer.",
  "Do not sound like a know-it-all repeating the post back. Never restate or summarise what they just said before adding your bit — start at your bit. No verdicts on the post ('great point', 'this is so true', 'exactly right', 'underrated take'). No lecturing, no opening with 'Actually', no lesson tacked on the end, no credentials. Never write a reply that would fit any other tweet.",
  "",
  "The reply itself is not going anywhere. You are in the thread because the subject is interesting, and that is the entire reason — no pitch, no plug, no mention of the founder's product, and no working round to what they do for a living inside the reply text.",
  "",
  "Each draft also carries a `cta`: the line the founder may append under it when they decide this post is worth an ask. It is separate from the reply and is usually left off.",
  "`offer` is in the request for one reason — so the cta can name something real. It must not appear anywhere in the reply text, in any form.",
  ...CTA_RULES,
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
          // Voice, and one fenced-off line of agenda.
          //
          // The ICP stays out — their keys too, since a model shown
          // `icp: null` still knows an ICP is a thing it is meant to
          // have — and the reply text is still written with nowhere to
          // steer. What changed is that a CTA has to name something the
          // founder actually has, and a model with no idea what that is
          // invents one. So the positioning arrives named for the only
          // field allowed to use it, which is the arrangement HeatCheck
          // has always run: an agenda with a designated outlet stays in
          // that outlet, an agenda with none leaks into the reply.
          voice_notes: brandPack.voice_notes,
          voice_samples: brandPack.reply_templates,
          offer: brandPack.business_summary,
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

function toWrittenDraft(value: unknown): WrittenDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.reply !== "string" || !isUsableComment(row.reply)) return null;
  return { text: row.reply.trim(), cta: cleanCta(row.cta) };
}

function parseReplies(input: Record<string, unknown>): WrittenDraft[] | null {
  const replies = Array.isArray(input.replies)
    ? input.replies.map(toWrittenDraft)
    : [];

  if (replies.length !== 2 || replies.some((draft) => draft === null)) {
    return null;
  }

  return replies as WrittenDraft[];
}

// The replies half now has something a regex can check — the length
// budget — so it gets the same one corrective retry the @grok question
// has always had. Before the budget existed there was nothing here to
// fail on and nothing to retry; a draft that runs long is the model
// meaning to write a comment and overshooting, which is exactly the kind
// of miss a second attempt fixes.
async function requestReplies(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): Promise<WrittenDraft[]> {
  const request = buildRepliesRequest(brandPack, tweet);
  const first = parseReplies(toolInput(await post(request), "save_replies"));
  if (first) return first;

  const second = parseReplies(
    toolInput(
      await post({
        ...request,
        messages: [
          ...request.messages,
          {
            role: "assistant",
            content: "The previous drafts were not usable.",
          },
          {
            role: "user",
            content: `Write the two drafts again. Each one: \`point\` naming the single thing it adds that the tweet does not already say, then a reply of ${COMMENT_MAX} characters or fewer built from that point, then a \`cta\` (empty string if there is nothing concrete to offer).`,
          },
        ],
      }),
      "save_replies",
    ),
  );

  if (!second) {
    throw new Error("Anthropic response did not include two usable replies.");
  }

  return second;
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
): Promise<WrittenDraft[]> {
  const [replies, grokQuestion] = await Promise.all([
    requestReplies(brandPack, tweet),
    requestGrok(brandPack, tweet),
  ]);

  // The @grok draft never carries a CTA. Its whole purpose is a public
  // answer in the thread, and an ask stapled underneath reads as bait.
  return [...replies, { text: grokQuestion, cta: null }];
}

export function buildMockDrafts(
  brandPack: BrandPackRow,
  tweet: TweetForDrafts,
): WrittenDraft[] {
  const author = tweet.author_handle ?? "them";
  const snippet = (tweet.content ?? "").slice(0, 60);

  return [
    {
      text: `[Mock draft 1] Replying to ${author} — set ANTHROPIC_API_KEY for real drafts.`,
      cta: "Want the mock process? Reply and I'll send it.",
    },
    {
      text: `[Mock draft 2] re: "${snippet}" — placeholder until ANTHROPIC_API_KEY is set.`,
      cta: null,
    },
    {
      text: `${GROK_HANDLE} [Mock draft 3] what's the strongest evidence either way here?`,
      cta: null,
    },
  ];
}

export async function insertDrafts(
  supabase: SupabaseServerClient,
  userId: string,
  tweetId: string,
  drafts: WrittenDraft[],
): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from("drafts")
    .insert(
      drafts.map((draft, i) => ({
        tweet_id: tweetId,
        user_id: userId,
        variant: i + 1,
        draft_text: draft.text,
        draft_cta: draft.cta,
        status: "draft",
      })),
    )
    .select();

  if (error) throw error;
  return data as DraftRow[];
}
