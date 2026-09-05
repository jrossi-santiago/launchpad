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
  description: "Save one reply to this specific post, in the founder's voice.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        maxLength: 280,
        description:
          "The reply, as one interested person talking to another. Under 280 characters, and specific to this post's actual content.",
      },
      hook: {
        type: "string",
        description:
          "The exact phrase, claim, number or detail in the post that caught your attention and that the reply picks up on. Quoted from the post, not paraphrased.",
      },
    },
    required: ["reply", "hook"],
  },
} as const;

// The `hook` field is the whole anti-generic mechanism: asking for the
// phrase that caught your attention, in the same tool call, forces the
// model to find one before it writes. A reply whose hook does not appear
// in the post is a reply that could have been written without reading it,
// and that is exactly the reply this feature exists to avoid — so it is
// rejected and asked for again.
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
  "- Pick the bit that actually caught your eye and say something back about it. Put that bit in `hook`, in the post's own words.",
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

type ReplyToolInput = { reply: string; hook: string };

function isReplyToolInput(input: unknown): input is ReplyToolInput {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.reply === "string" && typeof value.hook === "string";
}

// Normalised containment: the model quotes the post's words but not always
// its punctuation or casing, and X text is full of curly quotes and
// non-breaking spaces that would fail a literal indexOf.
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

// True when the hook is really drawn from the post. Short hooks are the
// interesting failure — a one-word hook ("this") is satisfied by almost
// any post — so they are held to the same containment test but must carry
// at least a couple of words to count as evidence of reading.
export function isGroundedReply(
  reply: string,
  hook: string,
  postText: string,
): boolean {
  const trimmed = reply.trim();
  if (trimmed.length === 0 || trimmed.length > 280) return false;

  const haystack = normalise(postText);
  const needle = normalise(hook);
  if (!haystack || !needle) return false;
  if (needle.split(" ").length < 2) return false;

  return haystack.includes(needle);
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

// Returns the reply text, or throws. One corrective retry when the first
// attempt is not anchored in the post — the same shape of retry the drafts
// module makes for an unusable @grok question.
export async function callHaikuFeedReply(
  brandPack: BrandPackRow,
  target: ReplyTarget,
  onTerritory = false,
): Promise<string> {
  const postText = [target.content ?? "", target.quoted?.text ?? ""].join(" ");
  const request = buildFeedReplyRequest(brandPack, target, onTerritory);
  let result = await requestReply(request);

  if (!isGroundedReply(result.reply, result.hook, postText)) {
    result = await requestReply({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: `Previous reply: ${result.reply}\nPrevious hook: ${result.hook}`,
        },
        {
          role: "user",
          content:
            "That reply was not anchored in the post. Rewrite it. Pick a specific phrase that appears in the post's own text — the bit you would actually react to — put that phrase in `hook` word for word, and reply to it as someone interested in the subject, not as someone assessing the post. Stay under 280 characters.",
        },
      ],
    });
  }

  const reply = result.reply.trim();
  if (!reply || reply.length > 280) {
    throw new Error("Model returned an unusable reply.");
  }

  return reply;
}

// Without an API key, still say something about this post rather than
// nothing — a mock that ignored the post would hide the one bug this
// feature can have.
export function buildMockFeedReply(target: ReplyTarget): string {
  const snippet = (target.content ?? "").trim().slice(0, 80);
  return `[Mock reply to @${target.handle}] re: "${snippet}" — set ANTHROPIC_API_KEY to have Haiku read this post and write a real reply.`;
}
