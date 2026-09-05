import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  BREVITY_RULES,
  COMMENT_MAX,
  CTA_FIELD,
  CTA_RULES,
  POINT_FIELD,
  cleanCta,
  isSubstantivePoint,
  isUsableComment,
} from "@/lib/anthropic/comment";
import {
  commentTypeField,
  commentTypeRules,
  isCommentType,
  violatesTypeRule,
  type CommentType,
} from "@/lib/anthropic/commentTypes";
import {
  legalCommentTypes,
  parseProofs,
  proofPayload,
  proofRules,
  violatesProofRule,
  wearsWitnessedProof,
  type Proof,
} from "@/lib/anthropic/proofs";
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
  // Which of the four comment types this is, when the comment is a
  // `value` one. Null for grok and pitch, which are their own shapes and
  // are not one of the four.
  commentType: CommentType | null;
  why: string;
  // What this comment adds to the thread, in the model's own words. On
  // the card next to `why`, because a comment whose point you disagree
  // with is one you want to catch before it goes under a post that is
  // already being read by thousands of people.
  point: string;
  // The optional ask, never appended here. The card decides.
  cta: string | null;
};

export type HeatCheckCard = FetchedTweet & {
  read: HeatCheckRead;
};

function saveCommentTool(proofs: Proof[]) {
  const typeField = commentTypeField(legalCommentTypes(proofs));
  return {
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
      comment_type: {
        ...typeField,
        description:
          `Which comment type you are writing. Required when kind is value. When kind is grok or pitch answer "question" and ignore it — it is not used. ${typeField.description}`,
      },
      why: {
        type: "string",
        description:
          "One short sentence — under 20 words — saying why that kind of comment suits this post. Written to the founder, not to the author.",
      },
      point: POINT_FIELD,
      comment: {
        type: "string",
        maxLength: COMMENT_MAX,
        description:
          `The comment to post, in the founder's voice, ${COMMENT_MAX} characters or fewer including spaces. One sentence, two only if the second is a question. A grok comment must contain @grok.`,
      },
      cta: CTA_FIELD,
    },
    required: ["about", "kind", "comment_type", "why", "point", "comment", "cta"],
  },
  } as const;
}

function systemPromptLines(proofs: Proof[]): string[] {
  return [
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
  "A `value` comment is one of a small number of kinds, and `comment_type` says which before you write it:",
  ...commentTypeRules(legalCommentTypes(proofs)),
  ...proofRules(proofs),
  "",
  "Then name the one thing your comment adds in `point`, and write the comment from that.",
  ...BREVITY_RULES.map((rule) => `- ${rule}`),
  "- It must read like a person typing a quick reply on their phone. No hashtags unless the brand voice uses them, no emoji unless the voice uses them.",
  "- Never restate or summarise the post before adding your bit. Start at your bit.",
  "- No verdicts on the post — no 'great point', 'this is so true', 'underrated take'. No lecturing, no opening with 'Actually', no credentials, no lesson tacked on the end.",
  "- Never write a comment that would fit any other post.",
  "- The founder's voice guardrails ('never say') override everything above.",
  "",
  "Then the `cta` — the line the founder may append under the comment when they decide this post is worth an ask.",
  ...CTA_RULES.map((rule) => `- ${rule}`),
  "- Leave `cta` empty for a `grok` comment. The point of tagging @grok is a public answer in the thread, and an ask stapled to it reads as bait.",
  "",
  "For a `grok` comment: tag @grok and ask it one genuine question about the post's subject.",
  "For a `pitch` comment: say plainly what the founder does and why it is relevant to what the post said. No link, no DM ask, no 'we're building the future of'. It should read like a person mentioning the thing they made, once, because it happens to fit.",
  "",
  "You cannot open links and you cannot see images. If the post's point depends on something you were not given, do not reconstruct it — write to the part you do have, or say in `why` that the post is thin without it.",
  ];
}

export function buildHeatCheckRequest(
  brandPack: BrandPackRow,
  tweet: FetchedTweet,
) {
  const proofs = parseProofs(brandPack.proofs);

  return {
    model: HEATCHECK_MODEL,
    max_tokens: 700,
    system: systemPromptLines(proofs).join("\n"),
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
          ...(proofs.length ? { proofs_you_may_use: proofPayload(proofs) } : {}),
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
    tools: [saveCommentTool(proofs)],
    tool_choice: { type: "tool", name: "save_comment" },
  };
}

type CommentToolInput = {
  about: string;
  kind: HeatCheckKind;
  comment_type: CommentType;
  why: string;
  point: string;
  comment: string;
  cta: string;
};

function isCommentToolInput(input: unknown): input is CommentToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.about === "string" &&
    (value.kind === "value" || value.kind === "grok" || value.kind === "pitch") &&
    isCommentType(value.comment_type) &&
    typeof value.why === "string" &&
    typeof value.point === "string" &&
    typeof value.comment === "string" &&
    typeof value.cta === "string"
  );
}

// Usable means postable: present, inside the comment budget, carrying a
// point somebody could disagree with, and — for a grok comment — actually
// tagging grok, since a grok question that forgot the tag is just a
// question shouted at nobody.
//
// The point is checked here rather than trusted because it is the whole
// mechanism: a model that cannot name what it is adding has written a
// comment that adds nothing, and that is the comment this feature exists
// to stop. An unusable CTA is not a failure — it is simply dropped.
// Returns the reason it cannot be posted, or null when it can. A reason
// rather than a boolean because it is what the corrective retry is given:
// "not postable" makes the model guess, "an operator add-on needs the
// figure" makes it fix the thing that is actually wrong.
function unusableReason(
  input: CommentToolInput,
  proofs: Proof[],
): string | null {
  const trimmed = input.comment.trim();

  if (!isUsableComment(trimmed)) {
    return `The comment must be ${COMMENT_MAX} characters or fewer, and must not open by grading the post ("great post", "so true", "congrats").`;
  }
  if (!isSubstantivePoint(input.point)) {
    return "`point` has to name the specific thing this comment adds that the post does not already say.";
  }
  if (input.kind === "grok" && !/@grok\b/i.test(trimmed)) {
    return "A grok comment has to contain @grok.";
  }
  // The four types are what a `value` comment can be. grok and pitch have
  // their own shapes and are checked above.
  if (input.kind === "value") {
    return (
      violatesTypeRule(input.comment_type, trimmed) ??
      violatesProofRule(input.comment_type, trimmed, proofs) ??
      wearsWitnessedProof(trimmed, proofs)
    );
  }
  return null;
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
  const proofs = parseProofs(brandPack.proofs);
  const request = buildHeatCheckRequest(brandPack, tweet);
  let result = await requestComment(request);

  let reason = unusableReason(result, proofs);
  if (reason) {
    result = await requestComment({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous kind: ${result.kind}\nPrevious comment_type: ${result.comment_type}\nPrevious point: ${result.point}\nPrevious comment: ${result.comment}`,
        },
        {
          role: "user",
          content: `That comment is not postable. ${reason} Write it again, ${COMMENT_MAX} characters or fewer including spaces, keeping the same reading of the post. You may pick a different \`comment_type\` if the one you chose is not one you can honestly fill.`,
        },
      ],
    });

    reason = unusableReason(result, proofs);
    if (reason) {
      throw new Error(`Model did not return a postable comment. ${reason}`);
    }
  }

  return {
    comment: result.comment.trim(),
    kind: result.kind,
    commentType: result.kind === "value" ? result.comment_type : null,
    why: result.why.trim(),
    point: result.point.trim(),
    // A grok comment never carries one, whatever the model returned.
    cta: result.kind === "grok" ? null : cleanCta(result.cta),
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
    commentType: kind === "value" ? "operator" : null,
    why: "Mock read — set ANTHROPIC_API_KEY to have Sonnet read this post.",
    point: "Mock point — what a real comment would add to this thread.",
    cta: kind === "grok" ? null : "Want the mock process? Reply and I'll send it.",
    comment:
      kind === "grok"
        ? `[Mock] @grok is this actually true for "${snippet}"?`
        : `[Mock ${kind} comment] on ${tweet.author_handle}: "${snippet}"`,
  };
}
