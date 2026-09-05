import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { QuotedPost } from "@/lib/getx/userTweets";

// One reply, written for one post, for the Feed's Reload button.
//
// This is deliberately not lib/anthropic/drafts.ts. That module writes the
// three options you pick between once you have decided to reply to a post
// — two replies plus a @grok question — and it costs a queue row to get
// them. Reload is the other direction: it writes a single ready reply for
// every fresh post so the Feed arrives already answerable, and it does so
// for many posts at once, which makes both the prompt and the budget
// different. What they share is the Brand Pack and the 280-character
// ceiling.

export type ReplyTarget = {
  handle: string;
  display_name: string | null;
  content: string | null;
  quoted: QuotedPost | null;
};

const SAVE_REPLY_TOOL = {
  name: "save_reply",
  description:
    "Say what this post is about, then reply to it — or say you cannot tell what it is about and decline.",
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
      reply: {
        type: "string",
        maxLength: 280,
        description:
          "The reply, as one interested person talking to another. Under 280 characters, and about what you described in `about`. Empty string when can_reply is false.",
      },
    },
    required: ["about", "unclear", "can_reply", "reply"],
  },
} as const;

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
const SYSTEM_PROMPT = [
  "You write X (Twitter) replies for a founder, in their own voice, from their Brand Pack.",
  "You are given one post. Write one reply to that post.",
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
  "It must read like a person typing a quick reply on their phone. One or two sentences, and it is fine if it does not wrap up neatly. Lowercase is fine if the voice notes suggest it.",
  "It MUST fit 280 characters including spaces and punctuation — tighten the wording rather than truncate.",
  "The founder's voice guardrails ('never say') override everything above.",
  "",
  "Before any of that: work out what the post is actually about, and say so in `about`. Name the real subject — the tool, the claim, the event, the argument — the way you would explain it to someone who had not seen it. If you cannot name it, you have not understood it.",
  "",
  "You are often missing things. A post's link is a bare t.co you cannot open. Its image you cannot see. It may turn on a person, product, in-joke or piece of news you do not know. Put every one of those in `unclear`.",
  "",
  "Then be honest in `can_reply`. It is true only if you could reply as someone who genuinely follows this. Set it false — and leave `reply` empty — when:",
  "- the post's point depends on a link or image you were not given",
  "- it turns on a name, product or event you do not actually recognise",
  "- you would have to guess what the author means to say anything at all",
  "- your reply would work just as well if the subject were something else entirely",
  "",
  "Declining is a good answer and costs nothing. A person who did not follow a post scrolls past it; they do not reply anyway and hope. Never write a reply that gestures vaguely at a post you did not understand, and never cover a gap with enthusiasm.",
];

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
];

function systemPrompt(onTerritory: boolean): string {
  return [
    ...SYSTEM_PROMPT,
    ...(onTerritory ? ON_TERRITORY_PROMPT : OFF_TERRITORY_PROMPT),
  ].join("\n");
}

export function buildFeedReplyRequest(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  onTerritory = false,
) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: systemPrompt(onTerritory),
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
            text: target.content,
            quoting: target.quoted
              ? { author: `@${target.quoted.handle}`, text: target.quoted.text }
              : null,
          },
        }),
      },
    ],
    tools: [SAVE_REPLY_TOOL],
    tool_choice: { type: "tool", name: "save_reply" },
  };
}

// What one call comes back with. `reply` is null when the model declined,
// and `about` / `unclear` survive either way — they are the diagnostic:
// reading what the model thought a post meant is how you tell a
// comprehension problem from a context problem.
export type FeedReplyResult = {
  reply: string | null;
  about: string;
  unclear: string | null;
};

type ReplyToolInput = {
  about: string;
  unclear: string;
  can_reply: boolean;
  reply: string;
};

function isReplyToolInput(input: unknown): input is ReplyToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.about === "string" &&
    typeof value.unclear === "string" &&
    typeof value.can_reply === "boolean" &&
    typeof value.reply === "string"
  );
}

// A reply the model believes it can write still has to be usable: present,
// and inside X's limit. Anything else earns the one corrective retry.
function isUsableReply(input: ReplyToolInput): boolean {
  const trimmed = input.reply.trim();
  return trimmed.length > 0 && trimmed.length <= 280;
}

// An `about` that describes the post's shape rather than its subject — "a
// post about productivity", "sharing an opinion" — is the tell that the
// model has not read it. Cheap to catch: a real one names things, so it
// runs longer than a category does.
function isSubstantiveAbout(about: string): boolean {
  return about.trim().split(/\s+/).length >= 6;
}

async function requestReply(body: unknown): Promise<ReplyToolInput> {
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
      (block as { name?: unknown }).name === "save_reply",
  );

  if (!toolUse || !isReplyToolInput(toolUse.input)) {
    throw new Error(
      "Anthropic response did not include a valid save_reply tool call.",
    );
  }

  return toolUse.input;
}

// Returns the reply and what the model made of the post, or throws.
//
// The one corrective retry is spent on a reply the model meant to write
// and botched — empty, over the limit, or written from an `about` too
// vague to have come from reading. A decline is never retried: pressing a
// model that just said it does not follow the post is how you get the
// bluff back.
export async function callHaikuFeedReply(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  onTerritory = false,
): Promise<FeedReplyResult> {
  const request = buildFeedReplyRequest(brandPack, target, onTerritory);
  let result = await requestReply(request);

  const needsRetry =
    result.can_reply && (!isUsableReply(result) || !isSubstantiveAbout(result.about));

  if (needsRetry) {
    result = await requestReply({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous about: ${result.about}\nPrevious reply: ${result.reply}`,
        },
        {
          role: "user",
          content:
            "That did not work. In `about`, name the specific thing this post is about — the tool, claim, event or argument — not the kind of post it is. Then write a reply to that, under 280 characters. If you genuinely cannot tell what the post is about, set can_reply to false and leave the reply empty; that is a fine answer.",
        },
      ],
    });
  }

  const about = result.about.trim();
  const unclear = result.unclear.trim() || null;

  if (!result.can_reply || !isUsableReply(result)) {
    return { reply: null, about, unclear };
  }

  return { reply: result.reply.trim(), about, unclear };
}

export function buildMockFeedReply(target: ReplyTarget): FeedReplyResult {
  const snippet = (target.content ?? "").trim().slice(0, 80);
  return {
    reply: `[Mock reply to @${target.handle}] re: "${snippet}" — set ANTHROPIC_API_KEY to have Haiku read this post and write a real reply.`,
    about: `A mock reading of @${target.handle}'s post, produced without a model.`,
    unclear: null,
  };
}
