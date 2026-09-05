import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  BREVITY_RULES,
  COMMENT_MAX,
  POINT_FIELD,
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
import type { ReplyTarget } from "@/lib/anthropic/feedReply";

// What to do with a post the model read and declined.
//
// A decline is the honest end of lib/anthropic/feedReply.ts: the post
// turned on a link it cannot open, an image it cannot see, or a person it
// does not know, so it said so instead of bluffing. That is the right
// answer for a machine and the wrong place for the card to stop — the
// founder looking at it is very often the one person who *does* know what
// the post means, and until now the only thing the card offered them was
// Done.
//
// So a declined card gets three buttons, and this module writes two of
// them. The third is the @grok question, which already exists in
// lib/anthropic/drafts.ts and is reused rather than rewritten.
//
// - `ask`   — the question the founder actually wants answered, built out
//             of the gap the model just admitted to. No new information
//             required from anyone: not understanding a post is itself a
//             reason to ask about it, and a real question is one of the
//             four comment types.
// - `steer` — the founder types the missing piece in one line and the
//             comment is written with it as fact. This is the half of the
//             feature that lets any post be commented on, because it
//             closes the exact gap `unclear` names.
//
// Neither carries a CTA. The ask is only ever written on a post judged to
// be about the founder's own field (see the on-territory note in
// feedReply.ts), and a post nobody could follow well enough to reply to
// has not been judged to be about anything. A model asked for one anyway
// would invent the asset, so the field is not in the tool at all.
export type AssistMode = "ask" | "steer";

export type AssistResult = {
  text: string;
  // Null is not possible here the way it is on a Reload: these calls are
  // made by someone who has decided this post is worth a comment, so
  // there is no decline path — only a comment or a thrown error.
  type: CommentType;
};

// `ask` is always a question, so its type is not a choice. Handing the
// model the four-way enum here would let it answer a post it has already
// said it cannot follow with an operator add-on carrying a number it
// cannot possibly have — which is the bluff the decline existed to stop,
// re-entered through the door marked "help".
//
// `steer` gets the full enum back, because the founder has just supplied
// the ground the model was missing and any of the four may now be
// honestly available.
function saveCommentTool(mode: AssistMode, proofs: Proof[]) {
  return {
    name: "save_comment",
    description: "Save one reply to this post.",
    input_schema: {
      type: "object",
      properties: {
        ...(mode === "steer"
          ? { comment_type: commentTypeField(legalCommentTypes(proofs)) }
          : {}),
        point: POINT_FIELD,
        comment: {
          type: "string",
          maxLength: COMMENT_MAX,
          description: `The reply, ${COMMENT_MAX} characters or fewer. One sentence — two only if the second is a question.`,
        },
      },
      required: [
        ...(mode === "steer" ? ["comment_type"] : []),
        "point",
        "comment",
      ],
    },
  } as const;
}

const SHARED_RULES = [
  "Write in the founder's voice, from their Brand Pack. It must read like a person typing a quick reply on their phone, not ad copy.",
  "Never pitch the founder's product, never link, no hashtags unless the brand voice uses them.",
  "No verdicts on the post: no 'great point', 'this is so true', 'love this'. Do not grade it, rank it, or restate it before you start.",
  ...BREVITY_RULES,
  "The founder's voice guardrails ('never say') override everything above.",
];

// The prompt for the button labelled "Ask the author".
//
// The one thing this must never do is say out loud that it could not see
// something. "I couldn't open your link, what was in it?" is a machine
// announcing its own blindness, and a person scrolling past does not
// narrate their browser — they ask about the thing itself. So the gap is
// given to the model as the *subject* of the question rather than as an
// excuse to explain.
const ASK_PROMPT = [
  "You write X (Twitter) replies for a founder, in their own voice.",
  "You were shown this post already and said you could not follow it well enough to reply. You were right, and you are not being asked to reply anyway.",
  "You are being asked for the other thing a person does with a post they find interesting and do not fully follow: they ask about it.",
  "",
  "Write one question to the author — the thing you actually want to know, built out of the gap in `what_you_were_missing`.",
  "",
  "Rules for the question:",
  "- One question. It ends at the question mark, and nothing follows it except, at most, one thing that happened to you, in first person.",
  "- Name the specific thing you are asking about — the number, the measure, the decision, the bit of the thing you cannot see.",
  "- Never announce what you could not see, open or recognise. Do not write 'I can't open the link', 'the image didn't load', 'not familiar with', or any version of them. Ask about the substance, as someone who read the post and wants the part that is not in it.",
  "- Never ask something the post already answers, and never a question you could answer yourself.",
  "- No 'thoughts?', 'curious?', 'any tips?'. Those are not questions, they are ways of appearing in the thread.",
  "- Do not guess at what the post is about in order to ask about it. If the missing piece is the whole subject, ask what the subject is — directly, in their words, without apologising for it.",
  "",
  ...SHARED_RULES,
  "",
  "Name what you want to know in `point` first — the single thing the answer would tell you. Then ask it.",
];

// The prompt for the button labelled "I'll fill the gap".
//
// The founder's note is treated as fact, and that is the whole mechanism:
// the model declined because it was missing something, the founder has
// supplied it, and the reply is now written from ground rather than from
// a guess. Which means the note is also the only thing standing between
// this and the bluff — so the model is told, twice, that it may use what
// it was given and nothing beyond it.
const STEER_PROMPT = [
  "You write X (Twitter) replies for a founder, in their own voice.",
  "You were shown this post already and said you could not follow it. The founder has now told you the part you were missing, in `what_the_founder_knows`.",
  "Treat what they told you as true. It is their own knowledge of this post, this person, or this subject, and it is the reason a reply is possible at all.",
  "",
  "Write one reply, built on what they told you.",
  "- Use their note as the ground you stand on. What it says is a fact you now know.",
  "- Do not extend it. Anything it does not cover, you still do not know — do not fill the rest of the post back in with a guess because one piece arrived.",
  "- Do not repeat their note back as though it were news to the author. They were there; you are the one who just caught up.",
  "- Do not mention the founder, the note, or the fact that you were told anything.",
  "",
  ...SHARED_RULES,
  "",
  "The reply is one of a small number of kinds, named in `comment_type` before you write it:",
  "__COMMENT_TYPE_RULES__",
  "",
  "Name what your reply adds in `point` before you write it — the result, the case that went the other way, the detail people miss, the thing you want to know.",
];

// The type rules and the proof list are spliced in rather than baked
// into STEER_PROMPT, because both depend on what the founder can prove
// and the prompt is a module-level constant.
function systemPrompt(mode: AssistMode, proofs: Proof[]): string {
  const lines = mode === "ask" ? ASK_PROMPT : STEER_PROMPT;
  return lines
    .flatMap((line) =>
      line === "__COMMENT_TYPE_RULES__"
        ? [...commentTypeRules(legalCommentTypes(proofs)), ...proofRules(proofs)]
        : [line],
    )
    .join("\n");
}

export function buildAssistRequest(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  mode: AssistMode,
  options: { unclear: string | null; note: string | null },
) {
  const proofs = parseProofs(brandPack.proofs);

  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: systemPrompt(mode, proofs),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          // Voice only, exactly as an off-territory Reload sends it. A
          // post nobody could read is not a post anyone judged to be
          // about the founder's field, so there is no agenda to include
          // and nothing for a reply to steer towards.
          voice_notes: brandPack.voice_notes,
          voice_samples: brandPack.reply_templates,
          ...(proofs.length ? { proofs_you_may_use: proofPayload(proofs) } : {}),
          post: {
            author: `@${target.handle}`,
            author_name: target.display_name,
            author_bio: target.bio,
            text: target.content,
            quoting: target.quoted
              ? { author: `@${target.quoted.handle}`, text: target.quoted.text }
              : null,
            ...(target.context?.links.length
              ? { links_you_cannot_open: target.context.links }
              : {}),
            ...(target.context?.media
              ? { images_you_cannot_see: target.context.media }
              : {}),
          },
          // The decline, handed back as working material. On `ask` it is
          // the subject of the question; on `steer` it is the thing the
          // founder's note is answering.
          what_you_were_missing: options.unclear,
          ...(mode === "steer"
            ? { what_the_founder_knows: options.note }
            : {}),
        }),
      },
    ],
    tools: [saveCommentTool(mode, proofs)],
    tool_choice: { type: "tool", name: "save_comment" },
  };
}

type AssistToolInput = {
  comment_type?: unknown;
  point: string;
  comment: string;
};

function isAssistToolInput(input: unknown): input is AssistToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.point === "string" && typeof value.comment === "string";
}

// The type a result carries. `ask` never asked the model for one — it is
// a question by construction — so it is filled in here rather than read
// off a field that does not exist.
function typeOf(mode: AssistMode, input: AssistToolInput): CommentType | null {
  if (mode === "ask") return "question";
  return isCommentType(input.comment_type) ? input.comment_type : null;
}

// Same enforcement every other generator in the app runs: the comment has
// to be present, inside the budget, not open on a verdict, and actually
// shaped like the type it claims. `ask` is held to the sharp-question
// rules like any other question — ends at the question mark, names the
// specific thing, no 'thoughts?' — which is the point of forcing the type
// rather than letting the model pick one.
function failureOf(
  mode: AssistMode,
  input: AssistToolInput,
  proofs: Proof[],
): string | null {
  const type = typeOf(mode, input);
  if (!type) {
    return "Name which kind of comment this is in `comment_type`, and write the comment in that shape.";
  }
  if (!isUsableComment(input.comment)) {
    return `That comment was not usable. It must be present, ${COMMENT_MAX} characters or fewer, and must not open by grading the post.`;
  }
  if (!isSubstantivePoint(input.point)) {
    return "Name the one thing this comment adds in `point` — concretely, in a clause. If you cannot name it, there is no comment to write.";
  }
  return (
    violatesTypeRule(type, input.comment) ??
    violatesProofRule(type, input.comment, proofs) ??
    wearsWitnessedProof(input.comment, proofs)
  );
}

async function requestComment(body: unknown): Promise<AssistToolInput> {
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

  if (!toolUse || !isAssistToolInput(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_comment tool call.",
    );
  }

  return toolUse.input;
}

// One comment, and the same one corrective retry the rest of the app
// gives: the retry is told which rule it broke rather than "that did not
// work", because a model told the actual rule fixes the actual thing.
//
// Unlike a Reload there is no decline to fall back on. Someone pressed a
// button asking for this comment, so a second failure throws and the card
// says so — an empty result with no explanation is worse than an error.
export async function callHaikuAssist(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  mode: AssistMode,
  options: { unclear: string | null; note: string | null },
): Promise<AssistResult> {
  const proofs = parseProofs(brandPack.proofs);
  const request = buildAssistRequest(brandPack, target, mode, options);
  let result = await requestComment(request);
  let failure = failureOf(mode, result, proofs);

  if (failure) {
    result = await requestComment({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous point: ${result.point}\nPrevious comment: ${result.comment}`,
        },
        { role: "user", content: `${failure} Write it again.` },
      ],
    });
    failure = failureOf(mode, result, proofs);
  }

  const type = typeOf(mode, result);
  if (failure || !type) {
    throw new Error(failure ?? "Could not write a usable comment.");
  }

  return { text: result.comment.trim(), type };
}

export function buildMockAssist(
  target: ReplyTarget,
  mode: AssistMode,
  options: { note: string | null },
): AssistResult {
  const author = `@${target.handle}`;
  return mode === "ask"
    ? {
        text: `[Mock] ${author} — what was the actual number behind this? Set ANTHROPIC_API_KEY for a real question.`,
        type: "question",
      }
    : {
        text: `[Mock] Written from your note "${(options.note ?? "").slice(0, 40)}" — set ANTHROPIC_API_KEY for a real reply?`,
        type: "question",
      };
}
