import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { anthropicMessages, toolInput } from "@/lib/anthropic/client";
import {
  BREVITY_RULES,
  COMMENT_MAX,
  CTA_FIELD,
  CTA_RULES,
  POINT_FIELD,
  PROFILE_CLICK_FIELD,
  SPECIFICITY_RULES,
  WHY_SPECIFIC_FIELD,
  cleanCta,
  isSubstantivePoint,
  isSubstantiveProfileClick,
  isSubstantiveWhySpecific,
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
import type { PostContext, QuotedPost } from "@/lib/getx/userTweets";

// One reply, written for one post, for the Feed's Reload button.
//
// This is deliberately not lib/anthropic/drafts.ts. That module writes the
// three options you pick between once you have decided to reply to a post
// — two replies plus a @grok question — and it costs a queue row to get
// them. Reload is the other direction: it writes a single ready reply for
// every fresh post so the Feed arrives already answerable, and it does so
// for many posts at once, which makes both the prompt and the budget
// different. What they share is the Brand Pack and the comment rules in
// lib/anthropic/comment.ts — one point, said short, with the ask kept as
// its own line.

export type ReplyTarget = {
  handle: string;
  display_name: string | null;
  // Who is posting. Half of what a fragment means is who said it — the
  // same sentence from a founder, a researcher and a comedian are three
  // different posts.
  bio: string | null;
  content: string | null;
  quoted: QuotedPost | null;
  // What the post links to and shows, when it does.
  context: PostContext | null;
};

// The CTA field only exists on an on-territory request. Off territory the
// founder's positioning is deliberately absent from the request (see the
// note below), so there is nothing for an honest ask to name — and a
// model asked for one anyway would invent the asset. A tool with no `cta`
// property cannot be answered with a made-up one.
function saveReplyTool(onTerritory: boolean, proofs: Proof[]) {
  const typeField = commentTypeField(legalCommentTypes(proofs));
  return {
    name: "save_reply",
    description:
      "Say what this post is about, then write two replies to it in different shapes — or say you cannot tell what it is about and decline.",
    input_schema: {
      type: "object",
      properties: {
        about: {
          type: "string",
          description:
            "What this post is actually saying, in plain language, as you would explain it to someone who had not seen it. Name the specific thing it is about — the tool, the claim, the event, the argument. Not a description of its shape ('a post about productivity'), and not a restatement of its words.",
        },
        unclear: {
          type: "string",
          description:
            "What you cannot tell from what you were given: a link you cannot open, an image you cannot see, a person or product you do not recognise, jargon whose meaning changes the point, a conversation you are missing. Empty string when the post stands on its own.",
        },
        can_reply: {
          type: "boolean",
          description:
            "True only if you could reply as someone who genuinely follows this, without guessing at anything in `unclear`. False if a reply would require pretending to know what this is about.",
        },
        replies: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          description:
            "Two replies to this post, best first. The first is the one you would actually send; the second is the best reply of a different kind, in case the first does not hold up. Empty array when can_reply is false.",
          items: {
            type: "object",
            properties: {
              comment_type: {
                ...typeField,
                description: `Which kind of reply this is, chosen before you write it. ${typeField.description}`,
              },
              point: POINT_FIELD,
              why_specific: WHY_SPECIFIC_FIELD,
              profile_click: PROFILE_CLICK_FIELD,
              reply: {
                type: "string",
                maxLength: COMMENT_MAX,
                description: `The reply, as one interested person talking to another. ${COMMENT_MAX} characters or fewer, one sentence — two only if the second is a question — and about what you described in \`about\`.`,
              },
              ...(onTerritory ? { cta: CTA_FIELD } : {}),
            },
            required: [
              "comment_type",
              "point",
              "why_specific",
              "profile_click",
              "reply",
              ...(onTerritory ? ["cta"] : []),
            ],
          },
        },
      },
      required: ["about", "unclear", "can_reply", "replies"],
    },
  } as const;
}

// The tool's field order is the comprehension check, and it replaces the
// `hook` field that used to sit here. A hook asked the model to copy a
// phrase out of the post, and copying is something you can do without
// understanding a word — so the guardrail was satisfied by exactly the
// behaviour it was meant to catch: a reply from someone who had skimmed.
//
// Tool arguments are generated in schema order, so `about` — what this
// post is actually saying, in plain language — has to exist before a
// reply can be written from it. `unclear` then names what the model was
// not given (the link it cannot open, the image it cannot see, the person
// it does not recognise), and `can_reply` is the way out: a post it does
// not follow comes back declined instead of bluffed.
//
// Declining is a feature, not a failure. Every card having to end in a
// reply is what produced the confident nonsense; a card that says "read
// this one yourself" is worth more than a reply that pretends.
//
// Grounding alone is not enough, though, and the prompt below is mostly
// about the other half. A model told to be specific about a post writes
// like someone marking it: it restates the post, ranks the claim, and
// hands back a verdict. That is a reply nobody wants in their mentions.
// What people reply to is a person who is into this — who liked a
// particular bit, has been there, wonders about the next step. So the
// prompt asks for that person, and bans the tics of the other one by
// name: openers that grade the post, restating what was just said, and
// the little lecture that follows.
//
// The third mechanism is what the model is not shown. The Brand Pack
// holds two different things: a voice (how this person talks) and an
// agenda (what they sell, who they want to reach). Sending both on every
// call is what made every reply carry a slant — hand a model a business
// summary and an ICP and it treats them as the job, finding the path from
// any post back to the founder's territory, twenty times out of twenty.
// A real person who knows a subject talks about their own corner of it
// maybe one time in six.
//
// So `on_territory` decides what goes in the request. Off — the default
// for almost every card — positioning and ICP are simply absent, and a
// reply cannot steer towards a territory it was never told about. On, for
// the few posts a first pass judged genuinely adjacent, they are included
// and the prompt says how to use them: as things this person knows, never
// as things they sell.
function systemPromptLines(proofs: Proof[]): string[] {
  return [
  "You write X (Twitter) replies for a founder, in their own voice, from their Brand Pack.",
  "You are given one post. Write two replies to that post, in `replies`, best first.",
  "",
  "Only the first one is going to be sent. The second exists because the first is checked against the shape it claims — an operator add-on with no number in it, a receipts story that happened to nobody, a question that answers itself — and a first reply that fails that check would otherwise leave this post with nothing under it. So the second is a real reply written to a different shape, not a variation on the first: different `comment_type`, different `point`, and it must stand on its own.",
  "Order them honestly. The first is the best reply this post can carry, by the ranking below; the second is the best of the kinds that are left. Do not hold back the good one to make a pair.",
  "",
  "Who you are in this reply: someone who knows this world well and likes talking about it. Not an expert grading the post — a person in the conversation because they find it interesting. You are replying to the author, not to an audience watching you reply.",
  "",
  "So write the way you would to someone you like:",
  "- Pick the bit that actually caught your eye and say something back about it.",
  "- Bring something of your own: what happened when you tried it, the case where it went differently, the detail people miss, the thing you have wondered about since.",
  "- Curiosity beats correction. If you see it differently, say so as your own read — 'huh, mine went the other way' — not as a fix.",
  "- A real question is a great reply, when you actually want the answer.",
  "- Warmth is allowed. Being into this is the point.",
  "",
  "Do not sound like a know-it-all repeating the post back:",
  "- Never restate or summarise what they just said before adding your bit. They know what they wrote — start at your bit.",
  "- No verdicts on the post: no 'great point', 'this is so true', 'exactly right', 'underrated take', 'love this'. Do not grade it, rank it, or tell them it is important.",
  "- No lecturing. Do not explain their own field to them, do not open with 'Actually', and do not tack a lesson onto the end.",
  "- No credentials, no name-dropping, no 'in my experience as a…'. If experience is relevant, tell the bit of it that is relevant.",
  "- Never write a reply that would fit any other post.",
  "",
  "Never pitch the founder's product, never link, no hashtags unless the brand voice uses them.",
  "It must read like a person typing a quick reply on their phone, and it is fine if it does not wrap up neatly. Lowercase is fine if the voice notes suggest it.",
  ...BREVITY_RULES,
  "The founder's voice guardrails ('never say') override everything above.",
  "",
  "A reply worth leaving is one of a small number of kinds, and `comment_type` names which before you write it:",
  ...commentTypeRules(legalCommentTypes(proofs)),
  ...proofRules(proofs),
  "",
  ...SPECIFICITY_RULES,
  "",
  "Name what your reply adds in `point` before you write it — the result you got, the case that went the other way, the detail people miss, the thing you actually want to know. A reply whose only point is that the post is right is not a reply; say what you would want to know instead.",
  "",
  "Before any of that: work out what the post is actually about, and say so in `about`. Name the real subject — the tool, the claim, the event, the argument — the way you would explain it to someone who had not seen it. If you cannot name it, you have not understood it.",
  "",
  "You are often missing things, and the post tells you which. `links` are pages you cannot open — you know a link is there and nothing about what is on the page. `media` counts images or video you cannot see; `media_alt` is the only description you will ever get of one, and is usually empty. A post may also turn on a person, product, in-joke or piece of news you do not know. Put every one of those in `unclear`.",
  "A post whose words lean on something you cannot see — 'this is wild', 'read this', 'look at the third one' — is a post you do not have. Say so; do not reconstruct what was probably in it.",
  "",
  "Then be honest in `can_reply`. It is true only if you could reply as someone who genuinely follows this. Set it false — and leave `reply` empty — when:",
  "- the post's point depends on a link or image you were not given",
  "- it turns on a name, product or event you do not actually recognise",
  "- you would have to guess what the author means to say anything at all",
  "- your reply would work just as well if the subject were something else entirely",
  "",
  "Declining is a good answer and costs nothing. A person who did not follow a post scrolls past it; they do not reply anyway and hope. Never write a reply that gestures vaguely at a post you did not understand, and never cover a gap with enthusiasm.",
  ];
}

// Almost every reply. There is no agenda in the request to steer towards,
// and this says out loud that there is nowhere to get to — a model with
// no goal will otherwise invent one to be useful.
const OFF_TERRITORY_PROMPT = [
  "",
  "This reply is not going anywhere. You are in this thread because the subject is interesting, and that is the entire reason.",
  "You are not steering towards a topic, not working towards a point about your own field, and not leaving a door open to one. React to what they actually said, and stop.",
  "It is fine for this reply to be small. 'ha, the second one gets me every time' is a real reply. Not every reply has to earn its keep.",
];

// The few posts a first pass judged genuinely adjacent to what this
// founder works on. The agenda is in the request for these, so the prompt
// has to say what it is for — knowing the field, not selling in it.
const ON_TERRITORY_PROMPT = [
  "",
  "This post is genuinely about what the founder works on, so what they know is worth bringing.",
  "Let it show in the substance: the thing you only know from doing this, the distinction that matters, the trap people fall into. Positioning and ICP are given to you as context for what this person understands — never as something to work into the reply.",
  "It still must not be a pitch. No product name, no link, no 'we built this', no 'that is exactly what we solve', no offer to help, no DM.",
  "Knowing the subject is what earns attention here. Talking about your company is what loses it.",
  "",
  "Because this one is on your ground, also write a `cta` — the line the founder may append under the reply when they decide this post is worth an ask.",
  ...CTA_RULES,
];

function systemPrompt(onTerritory: boolean, proofs: Proof[]): string {
  return [
    ...systemPromptLines(proofs),
    ...(onTerritory ? ON_TERRITORY_PROMPT : OFF_TERRITORY_PROMPT),
  ].join("\n");
}

export function buildFeedReplyRequest(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  onTerritory = false,
) {
  // The proof list travels with the Brand Pack, so every caller that
  // already loads one gets the gate without changing.
  const proofs = parseProofs(brandPack.proofs);

  return {
    model: "claude-haiku-4-5-20251001",
    // Two drafts rather than one, so the ceiling moved with them. It is
    // still a ceiling and not a target: the replies are capped at
    // COMMENT_MAX by the schema, and everything else here is one clause.
    max_tokens: 1024,
    system: systemPrompt(onTerritory, proofs),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          // The voice half of the Brand Pack, on every call: this is how
          // the person talks, and it is needed whatever they talk about.
          voice_notes: brandPack.voice_notes,
          // The templates are shown to the model as voice samples, not as
          // text to reuse: a Reload that handed back a template would be
          // the generic reply this feature replaces.
          voice_samples: brandPack.reply_templates,
          // The only results this reply may claim. Sent as data next to
          // the post rather than folded into the prompt, so an empty
          // list reads as "you have none" instead of disappearing.
          ...(proofs.length ? { proofs_you_may_use: proofPayload(proofs) } : {}),
          // The agenda half, and only when the post is actually about it.
          // Spread rather than set to null, so an off-territory request
          // does not carry the keys at all — a model shown `icp: null`
          // still knows an ICP is a thing it is meant to have.
          ...(onTerritory
            ? { positioning: brandPack.business_summary, icp: brandPack.icp }
            : {}),
          post: {
            author: `@${target.handle}`,
            author_name: target.display_name,
            author_bio: target.bio,
            text: target.content,
            quoting: target.quoted
              ? { author: `@${target.quoted.handle}`, text: target.quoted.text }
              : null,
            // Named for what they are from where the model sits: things
            // attached to this post that it cannot open or see. Absent
            // when the post is only words, so their presence means
            // something is genuinely missing.
            ...(target.context?.links.length
              ? { links_you_cannot_open: target.context.links }
              : {}),
            ...(target.context?.media
              ? {
                  images_you_cannot_see: target.context.media,
                  image_descriptions: target.context.media_alt.length
                    ? target.context.media_alt
                    : undefined,
                }
              : {}),
          },
        }),
      },
    ],
    tools: [saveReplyTool(onTerritory, proofs)],
    tool_choice: { type: "tool", name: "save_reply" },
  };
}

// What one call comes back with. `reply` is null when the model declined,
// and `about` / `unclear` survive either way — they are the diagnostic:
// reading what the model thought a post meant is how you tell a
// comprehension problem from a context problem.
export type FeedReplyResult = {
  reply: string | null;
  // Which of the four kinds of comment this is. Null on a decline, where
  // there is no reply for it to describe.
  commentType: CommentType | null;
  about: string;
  unclear: string | null;
  // The ask, written apart from the reply and only ever on an
  // on-territory post. Null everywhere else, and null is the common case.
  cta: string | null;
  // Which of the two drafts was sent, and whether a second call was
  // needed at all. Kept apart because they answer different questions and
  // a decline has an answer to only one of them: `source` is null when
  // nothing was sendable, `retried` is still true if a round trip was
  // spent finding that out.
  //
  // Between them they are the whole case for asking for two drafts.
  // `alternate` counts the cards that would have cost a second round trip
  // under the old shape; `retried` counts the ones that still do. A sweep
  // where alternate is near zero is a sweep paying for a spare it never
  // uses — ReloadSummary totals both into the usage row so that is a
  // question the data can answer.
  source: "primary" | "alternate" | null;
  retried: boolean;
};

type ReplyCandidate = {
  comment_type: CommentType;
  point: string;
  why_specific: string;
  profile_click: string;
  reply: string;
  cta?: string;
};

type ReplyToolInput = {
  about: string;
  unclear: string;
  can_reply: boolean;
  replies: ReplyCandidate[];
};

function isCandidate(value: unknown): value is ReplyCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCommentType(candidate.comment_type) &&
    typeof candidate.point === "string" &&
    typeof candidate.why_specific === "string" &&
    typeof candidate.profile_click === "string" &&
    typeof candidate.reply === "string"
  );
}

function isReplyToolInput(input: unknown): input is ReplyToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.about === "string" &&
    typeof value.unclear === "string" &&
    typeof value.can_reply === "boolean" &&
    // A decline comes back with an empty array, so the array has to exist
    // but does not have to hold anything.
    Array.isArray(value.replies) &&
    value.replies.every(isCandidate)
  );
}

// Why this candidate cannot be sent, or null when it can.
//
// One function rather than the five scattered conditions it replaces,
// because with two candidates in hand the question changed. It used to be
// "does this need a retry", answered by a boolean; it is now "which of
// these two is usable", which needs a reason — the reason is what picks
// the second candidate over the first, and what the retry is told when
// neither survives.
function candidateFailure(
  candidate: ReplyCandidate,
  proofs: Proof[],
): string | null {
  if (!isUsableComment(candidate.reply)) {
    return `That reply is empty, over ${COMMENT_MAX} characters, or opens with a verdict on the post.`;
  }

  const shape =
    violatesTypeRule(candidate.comment_type, candidate.reply) ??
    // Shape first, then provenance: "an operator add-on needs a figure"
    // is a more useful correction than "that number is not yours" when
    // there is no number at all.
    violatesProofRule(candidate.comment_type, candidate.reply, proofs) ??
    wearsWitnessedProof(candidate.reply, proofs);
  if (shape) return shape;

  // A reply that names no point, or cannot say why it dies on any other
  // post, is the model writing before it worked out what it was adding.
  if (!isSubstantivePoint(candidate.point)) {
    return "That `point` names nothing. Say the one thing your reply adds that the post does not already contain.";
  }
  if (!isSubstantiveWhySpecific(candidate.why_specific)) {
    return '`why_specific` has to name what in THIS post the reply depends on — "it is relevant to the topic" means the reply fits anywhere, which is the reply to avoid.';
  }
  if (!isSubstantiveProfileClick(candidate.profile_click)) {
    return 'Finish "this is the person who ___" with something concrete they have done or know, not an adjective and not "agrees with the post".';
  }

  return null;
}

// An `about` that describes the post's shape rather than its subject — "a
// post about productivity", "sharing an opinion" — is the tell that the
// model has not read it. Cheap to catch: a real one names things, so it
// runs longer than a category does.
function isSubstantiveAbout(about: string): boolean {
  return about.trim().split(/\s+/).length >= 6;
}

// Eight of these run at once during a sweep, so the rate limiter is an
// ordinary part of the day rather than an outage — the backoff that makes
// that survivable lives in lib/anthropic/client.ts.
async function requestReply(body: unknown): Promise<ReplyToolInput> {
  const input = toolInput(await anthropicMessages(body), "save_reply");

  if (!isReplyToolInput(input)) {
    throw new Error(
      "Anthropic response did not include a valid save_reply tool call.",
    );
  }

  return input;
}

// The first candidate that survives the checks, with the reason the ones
// before it did not. Order is the ranking — the model was asked for its
// best reply first — so taking the first usable one keeps the priority
// and only spends the spare when the good one is broken.
function pickCandidate(
  input: ReplyToolInput,
  proofs: Proof[],
): { candidate: ReplyCandidate; index: number } | { reasons: string[] } {
  const reasons: string[] = [];

  for (const [index, candidate] of input.replies.entries()) {
    const failure = candidateFailure(candidate, proofs);
    if (!failure) return { candidate, index };
    reasons.push(failure);
  }

  return { reasons };
}

// Returns the reply and what the model made of the post, or throws.
//
// Two drafts arrive from one call, and the second is the whole point of
// this shape. The checks that decide whether a reply is sendable are
// mechanical — a shape it claimed and did not deliver, a justification
// that names nothing — and a model that fails one of them has usually
// written a fine reply of a different kind. Asking for that different
// kind up front costs a few dozen output tokens; asking for it afterwards
// costs a second round trip, on a card holding up one of eight lanes.
//
// The corrective retry is still here, and still one. It is now what
// happens when both drafts fail, which is a much stronger signal than one
// failing was — and it is told exactly what was wrong with each, because
// a model that hears "that did not work" twice guesses twice.
//
// A decline is never retried: pressing a model that just said it does not
// follow the post is how you get the bluff back.
export async function callHaikuFeedReply(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  onTerritory = false,
): Promise<FeedReplyResult> {
  const proofs = parseProofs(brandPack.proofs);
  const request = buildFeedReplyRequest(brandPack, target, onTerritory);
  let result = await requestReply(request);
  let picked = result.can_reply
    ? pickCandidate(result, proofs)
    : { reasons: [] as string[] };
  let retried = false;

  // `about` is judged apart from the drafts and can send a good pair
  // back on its own: it is the comprehension check, and a reply written
  // from an `about` too vague to have come from reading the post is a
  // reply that got there by luck.
  const understood = isSubstantiveAbout(result.about);

  if (result.can_reply && ("reasons" in picked || !understood)) {
    const reasons = "reasons" in picked ? picked.reasons : [];
    result = await requestReply({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: [
            `Previous about: ${result.about}`,
            ...result.replies.map(
              (candidate, index) =>
                `Previous reply ${index + 1} (${candidate.comment_type}): ${candidate.reply}`,
            ),
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            reasons.length
              ? `Neither reply can be sent. ${reasons.map((reason, index) => `Reply ${index + 1}: ${reason}`).join(" ")}`
              : "",
            understood
              ? ""
              : "And `about` describes the kind of post this is rather than what it says. Name the specific thing — the tool, claim, event or argument.",
            `Write two more, ${COMMENT_MAX} characters or fewer each, in two different shapes you can actually fill. If you genuinely cannot tell what the post is about, set can_reply to false and leave \`replies\` empty; that is a fine answer.`,
          ]
            .filter(Boolean)
            .join(" "),
        },
      ],
    });

    retried = true;
    picked = result.can_reply
      ? pickCandidate(result, proofs)
      : { reasons: [] as string[] };
  }

  const about = result.about.trim();
  const unclear = result.unclear.trim() || null;

  // A second failure is a decline rather than a third attempt: four
  // drafts that all failed the same mechanical checks are the model
  // saying there is no specific comment here, and "no comment" is a
  // correct answer.
  if (!result.can_reply || "reasons" in picked) {
    return {
      reply: null,
      commentType: null,
      about,
      unclear,
      cta: null,
      source: null,
      retried,
    };
  }

  return {
    reply: picked.candidate.reply.trim(),
    commentType: picked.candidate.comment_type,
    about,
    unclear,
    // Absent from the tool off territory, so this is null for almost
    // every card by construction rather than by policy.
    cta: cleanCta(picked.candidate.cta),
    source: picked.index === 0 ? "primary" : "alternate",
    retried,
  };
}

export function buildMockFeedReply(target: ReplyTarget): FeedReplyResult {
  const snippet = (target.content ?? "").trim().slice(0, 80);
  return {
    commentType: "question",
    source: "primary",
    retried: false,
    reply: `[Mock reply to @${target.handle}] re: "${snippet}" — set ANTHROPIC_API_KEY to have Haiku read this post and write a real reply.`,
    about: `A mock reading of @${target.handle}'s post, produced without a model.`,
    unclear: null,
    cta: "Want the mock process? Reply and I'll send it.",
  };
}
