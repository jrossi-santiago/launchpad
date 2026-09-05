import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { FetchedTweet } from "@/lib/getx/tweet";

// HeatCheck is the one place in the app that runs Sonnet rather than
// Haiku. The job is different from the Feed's: there, a post is handed to
// the model and it writes in the founder's voice. Here the model has to
// read a stranger's post that is already winning, decide what kind of
// comment would actually earn a place under it, and then write that one
// comment. Choosing between three postures — and being honest about which
// one the post can carry — is judgement, and judgement is what the bigger
// model is for. It stays affordable because HeatCheck only runs when the
// button is pressed, three times a day.
export const HEATCHECK_MODEL = "claude-sonnet-5";

export type HeatCheckKind = "value" | "grok" | "pitch";

export type HeatCheckRead = {
  comment: string;
  kind: HeatCheckKind;
  why: string;
};

export type HeatCheckCard = FetchedTweet & {
  read: HeatCheckRead;
};

const SAVE_COMMENT_TOOL = {
  name: "save_comment",
  description:
    "Save one comment to post under this tweet, the kind of comment it is, and why that kind.",
  input_schema: {
    type: "object",
    properties: {
      about: {
        type: "string",
        description:
          "What this post is actually about — the tool, claim, event or argument, named the way you would explain it to someone who had not seen it. Not the kind of post it is.",
      },
      kind: {
        type: "string",
        enum: ["value", "grok", "pitch"],
        description:
          "value = add something of your own to the subject; grok = tag @grok and ask it one real question the thread would want answered; pitch = the post is about the exact problem the founder solves, so say what you do.",
      },
      why: {
        type: "string",
        description:
          "One short sentence — under 20 words — saying why that kind of comment suits this post. Written to the founder, not to the author.",
      },
      comment: {
        type: "string",
        maxLength: 280,
        description:
          "The comment to post, in the founder's voice, under 280 characters including spaces. A grok comment must contain @grok.",
      },
    },
    required: ["about", "kind", "why", "comment"],
  },
} as const;

const SYSTEM_PROMPT = [
  "You are reading a high-performing X (Twitter) post from the last 24 hours in a founder's niche, and writing the one comment they should leave under it.",
  "This post is already getting attention. A good comment is read by everyone who came for the post — which is the entire point, and also the reason a bad one is expensive.",
  "",
  "First work out what the post is actually about and say so in `about`. Name the real subject. If you cannot name it, you have not read it.",
  "",
  "Then pick the kind of comment this post can carry. Exactly one of:",
  "- `value`: you have something of your own to add to the subject — what happened when you tried it, the case that went differently, the detail people miss, a real question you want the answer to. This is the right answer most of the time.",
  "- `grok`: the thread is turning on a factual question nobody has settled — a number, a claim, a comparison — and asking @grok publicly would genuinely serve the people reading. Never a question you could answer yourself, and never a device for getting your own topic into the thread.",
  "- `pitch`: the post is about the exact problem this founder's product solves, and someone reading it would want to know the product exists. Only when it is that direct. Wanting to pitch is not a reason.",
  "",
  "Then write the comment.",
  "- It must read like a person typing a quick reply on their phone: one or two sentences, no hashtags unless the brand voice uses them, no emoji unless the voice uses them.",
  "- Never restate or summarise the post before adding your bit. Start at your bit.",
  "- No verdicts on the post — no 'great point', 'this is so true', 'underrated take'. No lecturing, no opening with 'Actually', no credentials, no lesson tacked on the end.",
  "- Never write a comment that would fit any other post.",
  "- It MUST fit 280 characters including spaces. Tighten the wording rather than truncate.",
  "- The founder's voice guardrails ('never say') override everything above.",
  "",
  "For a `grok` comment: tag @grok and ask it one genuine question about the post's subject.",
  "For a `pitch` comment: say plainly what the founder does and why it is relevant to what the post said. No link, no DM ask, no 'we're building the future of'. It should read like a person mentioning the thing they made, once, because it happens to fit.",
  "",
  "You cannot open links and you cannot see images. If the post's point depends on something you were not given, do not reconstruct it — write to the part you do have, or say in `why` that the post is thin without it.",
];

export function buildHeatCheckRequest(
  brandPack: BrandPackRow,
  tweet: FetchedTweet,
) {
  return {
    model: HEATCHECK_MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT.join("\n"),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          // Unlike the Feed, the whole Brand Pack goes in every request.
          // The model cannot choose between value, grok and pitch without
          // knowing what there is to pitch — the choice is the feature.
          positioning: brandPack.business_summary,
          icp: brandPack.icp,
          voice_notes: brandPack.voice_notes,
          voice_samples: brandPack.reply_templates,
          post: {
            author: tweet.author_handle,
            text: tweet.content,
            likes: tweet.metrics.like_count,
            retweets: tweet.metrics.retweet_count,
            replies: tweet.metrics.reply_count,
          },
        }),
      },
    ],
    tools: [SAVE_COMMENT_TOOL],
    tool_choice: { type: "tool", name: "save_comment" },
  };
}

type CommentToolInput = {
  about: string;
  kind: HeatCheckKind;
  why: string;
  comment: string;
};

function isCommentToolInput(input: unknown): input is CommentToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.about === "string" &&
    (value.kind === "value" || value.kind === "grok" || value.kind === "pitch") &&
    typeof value.why === "string" &&
    typeof value.comment === "string"
  );
}

// Usable means postable: present, inside X's limit, and — for a grok
// comment — actually tagging grok, since a grok question that forgot the
// tag is just a question shouted at nobody.
function isUsable(input: CommentToolInput): boolean {
  const trimmed = input.comment.trim();
  if (trimmed.length === 0 || trimmed.length > 280) return false;
  if (input.kind === "grok" && !/@grok\b/i.test(trimmed)) return false;
  return true;
}

async function requestComment(body: unknown): Promise<CommentToolInput> {
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
      (block as { name?: unknown }).name === "save_comment",
  );

  if (!toolUse || !isCommentToolInput(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_comment tool call.",
    );
  }

  return toolUse.input;
}

// One corrective retry, spent on a comment the model meant to write and
// botched — empty, over the limit, or a grok question missing its tag.
export async function callSonnetHeatCheck(
  brandPack: BrandPackRow,
  tweet: FetchedTweet,
): Promise<HeatCheckRead> {
  const request = buildHeatCheckRequest(brandPack, tweet);
  let result = await requestComment(request);

  if (!isUsable(result)) {
    result = await requestComment({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous kind: ${result.kind}\nPrevious comment: ${result.comment}`,
        },
        {
          role: "user",
          content:
            "That comment is not postable. Write it again: under 280 characters including spaces, and if the kind is grok it must contain @grok. Keep the same reading of the post.",
        },
      ],
    });

    if (!isUsable(result)) {
      throw new Error("Model did not return a postable comment.");
    }
  }

  return {
    comment: result.comment.trim(),
    kind: result.kind,
    why: result.why.trim(),
  };
}

export function buildMockHeatCheckRead(tweet: FetchedTweet): HeatCheckRead {
  // Deterministic spread across the three kinds so the tab can be seen
  // whole with no ANTHROPIC_API_KEY set.
  const kinds: HeatCheckKind[] = ["value", "value", "grok", "value", "pitch"];
  const index = Number(tweet.x_tweet_id.slice(-1)) % kinds.length;
  const kind = kinds[index];
  const snippet = tweet.content.trim().slice(0, 60);

  return {
    kind,
    why: "Mock read — set ANTHROPIC_API_KEY to have Sonnet read this post.",
    comment:
      kind === "grok"
        ? `[Mock] @grok is this actually true for "${snippet}"?`
        : `[Mock ${kind} comment] on ${tweet.author_handle}: "${snippet}"`,
  };
}
