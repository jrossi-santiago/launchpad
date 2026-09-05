// The rules every generated comment in the app obeys, in one place.
//
// Three generators write comments — HeatCheck under a stranger's winning
// post, Feed Reload under a watched account's post, and the queue's draft
// options — and each used to carry its own copy of "keep it short" as
// prose in a prompt, validated by nothing but X's own 280-character
// ceiling. A ceiling is a target: the model filled it. Every comment came
// back three sentences long, agreeing with the post at length and leaving
// no room for anything after it.
//
// So the ceiling moved, and split in two. A comment gets 180 characters,
// which is roughly one sentence and a question, and the remaining ~90 are
// held for a call to action that can be appended when the founder decides
// this post is worth one. Both halves together stay inside 280 with room
// to spare, so nothing has to be re-tightened at the point of posting.

// One sentence, or two when the second is a question. Enforced by the
// tool schema *and* by the validators here — the schema is a request, the
// validator is what actually sends a too-long comment back to be redone.
export const COMMENT_MAX = 180;

// The CTA line. Long enough for "Want the process? Reply and I'll DM it",
// short enough that it cannot become a second comment.
export const CTA_MAX = 80;

// How long the fields in front of the comment are allowed to run.
//
// Every one of these is generated before the comment itself — that is the
// entire mechanism, since tool arguments come back in schema order — and
// every one of them is therefore latency the person waiting pays before a
// single character of the reply exists. On a sweep of thirty cards, eight
// at a time, the padding in front of the comment is a real part of how
// long the button takes.
//
// The floors are not new. `isSubstantivePoint` and its neighbours have
// always rejected a field that ran too short, because a justification
// that names nothing is the tell that nothing is being justified. What is
// new is that the model is told what they are. It was being marked
// against a minimum nobody had mentioned, which is the reliable way to
// get an essay: write long enough and you cannot be too short.
//
// So each field now names both ends, from the same constant the validator
// reads. A window is a target you can hit. A floor you cannot see is a
// reason to keep typing.
export const POINT_MIN_WORDS = 4;
export const POINT_MAX_WORDS = 12;
export const WHY_SPECIFIC_MIN_WORDS = 5;
export const WHY_SPECIFIC_MAX_WORDS = 15;
export const PROFILE_CLICK_MIN_WORDS = 3;
export const PROFILE_CLICK_MAX_WORDS = 10;

// `maxLength` alongside the word window, because the schema is the half
// of this the model cannot talk itself out of. Roughly seven characters a
// word, which leaves room for the long ones rather than cutting a field
// off mid-thought at exactly the wrong moment.
const CHARS_PER_WORD = 7;

// What a comment has to do to be worth the space it takes under someone
// else's post. `point` in the tool schema is the enforcement: it is
// generated before the comment (tool arguments come back in schema
// order), so the model has to name what it is adding before it is allowed
// to add it. Naming nothing is how you catch a comment that agrees with
// the post and stops.
export const POINT_FIELD = {
  type: "string",
  maxLength: POINT_MAX_WORDS * CHARS_PER_WORD,
  description: `The one thing this comment adds that the post does not already contain — a result, a case that went the other way, a detail people miss, or something you want answered. ${POINT_MIN_WORDS}-${POINT_MAX_WORDS} words, concrete, no sentence. If you cannot name it, there is no comment to write.`,
} as const;

export const BREVITY_RULES = [
  "Length is the whole discipline here. One sentence. Two only if the second is a question.",
  `The comment MUST fit ${COMMENT_MAX} characters including spaces — much shorter than X allows, on purpose. Cut words, never truncate.`,
  "No wind-up and no wrap-up. Start at the point, stop when it is made. Nothing that agrees, grades or thanks before the point arrives, and no lesson after it.",
  "Say the point in `point` first, in your own words. If the only thing you can name is that the post is right, there is nothing to add and the comment is not worth writing — say what you would want to know instead.",
];

// The CTA is written by the same call but kept apart from the comment,
// never appended to it here. What goes out is the founder's decision at
// the moment of posting: the comment alone is the default, and the CTA is
// a toggle on the card. A model that writes the ask into the comment
// takes that decision away, so the prompt is explicit that they are two
// separate strings.
export const CTA_FIELD = {
  type: "string",
  description:
    `An optional one-line call to action the founder may append under the comment, ${CTA_MAX} characters or fewer. Name the specific thing they have — the process, the breakdown, the list — then ask for a reply: "Want the process? Reply and I'll send it." Empty string when there is nothing concrete to offer.`,
} as const;

export const CTA_RULES = [
  "The `cta` is a separate line, never part of the comment. Do not append it, do not hint at it, and do not let it change how the comment is written — the comment must stand entirely on its own, because most of the time it goes out without the CTA attached.",
  "A CTA names something the founder actually has, based on their positioning, and asks for a reply to get it. No link, no DM-me-your-email, no pitch, no product name being sold.",
  "Leave it empty rather than inventing an asset the founder never mentioned. An empty CTA is a fine answer.",
];

// A point that names nothing is the tell that nothing is being added.
// Same cheap check the Feed already runs on `about`: a real one names
// things, so it runs longer than a category does.
//
// The floor is read from the same constant the field description quotes,
// so the number the model is given and the number it is judged against
// cannot drift apart.
export function isSubstantivePoint(point: string): boolean {
  return point.trim().split(/\s+/).length >= POINT_MIN_WORDS;
}

// The comments the system doc kills by name: the ones that are socially
// and algorithmically invisible. Every prompt in the app already bans
// them in prose, and prose is a request — this is the check that makes it
// a rule, because the failure is not subtle enough to need judgement.
//
// Anchored to the start, because that is where the damage is: the first
// line is the only one that shows in a notification, and a comment that
// spends it grading the post has spent all of it. "Congrats on the raise,
// but the pricing bit is what got me" is caught for exactly that reason —
// the good half is the second clause, and it should have been first. The
// same words further in are ordinary English and are left alone.
const BANNED_OPENERS =
  /^\s*(great post|great point|so true|this\.|this!|this is so true|this is gold|love this|well said|spot on|100%|facts|agreed|couldn'?t agree more|exactly this|exactly right|underrated take|congrats|congratulations|amazing|incredible|beautifully said|nailed it|thanks for sharing)\b/i;

export function hasBannedOpener(text: string): boolean {
  return BANNED_OPENERS.test(text);
}

// Usable means postable: present, inside the budget, and not opening with
// a verdict on the post.
export function isUsableComment(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > COMMENT_MAX) return false;
  return !hasBannedOpener(trimmed);
}

// Anything unusable comes back as null rather than as a shorter CTA: a
// truncated ask reads worse than no ask, and the comment is designed to
// stand alone anyway. Links are stripped for the same reason the prompts
// ban them — a link in a reply is what gets the reply buried.
export function cleanCta(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CTA_MAX) return null;
  if (/https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

// The two fields that make the comment prove it is about THIS post,
// generated before the comment for the same reason `point` and
// `comment_type` are: tool arguments come back in schema order, so a
// claim made after the fact is a label, and a claim made first is a
// constraint.
//
// `why_specific` is the reusable-comment test. Every prompt in the app
// already says "never write a reply that would fit any other post", and
// prose is a request — this is the version the model has to answer.
// A comment whose only justification is that it is "relevant to the
// topic" is the generic comment, and it is caught by asking for the
// justification rather than by reading the comment.
//
// `profile_click` is the goal itself, made explicit. The whole point of
// commenting under someone else's post is that a stranger reads it and
// opens the profile — so the model names who this comment makes the
// founder look like before it writes it. Vague there means vague in the
// comment.
export const WHY_SPECIFIC_FIELD = {
  type: "string",
  maxLength: WHY_SPECIFIC_MAX_WORDS * CHARS_PER_WORD,
  description: `What in THIS post the comment depends on — their number, their claim, the tool they named, the decision they described. ${WHY_SPECIFIC_MIN_WORDS}-${WHY_SPECIFIC_MAX_WORDS} words. "Relevant to the topic" is not an answer: it means the comment fits anywhere, so write a different one.`,
} as const;

export const PROFILE_CLICK_FIELD = {
  type: "string",
  maxLength: PROFILE_CLICK_MAX_WORDS * CHARS_PER_WORD,
  description: `Finish "this is the person who ___" — what they have done or know, not an adjective. ${PROFILE_CLICK_MIN_WORDS}-${PROFILE_CLICK_MAX_WORDS} words. If the honest answer is "agrees with the post", there is no comment here.`,
} as const;

export const SPECIFICITY_RULES = [
  "Before writing, answer `why_specific`: what in THIS post does your comment depend on? A comment that would survive being pasted under a different post is the comment this exists to prevent, and naming the dependency is how you find out you do not have one.",
  "Then `profile_click`: what does a stranger think the founder is, having read it? 'The person who ___' — something they have done or know. This is the whole return on the comment. If you cannot fill it, the comment is not worth the space.",
];

// The hand-wavy answers. Each is a way of saying "it is on topic", which
// is exactly what a generic comment's justification looks like — the
// failure is not subtle enough to need judgement.
const HAND_WAVY =
  /^\s*(it'?s |this is |because it'?s |just )?(relevant|related|on ?-?topic|about the (same )?(topic|subject|thing)|fits the (post|topic|subject)|matches the (post|topic|theme)|speaks to (the|this)|applies to (the|this) (post|topic)|generic|general)\b/i;

// A justification that names nothing runs short. Same cheap test the Feed
// already runs on `about` and `point`, at the length a real dependency
// takes to state.
export function isSubstantiveWhySpecific(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length < WHY_SPECIFIC_MIN_WORDS) return false;
  return !HAND_WAVY.test(trimmed);
}

// "Agrees with the post" and its cousins: the answer that says the
// comment buys nothing, given honestly. Caught rather than trusted,
// because a model that has written a generic comment will still fill
// this field in.
const NO_ONE_IN_PARTICULAR =
  /\b(agrees?|agreeing|supports?|likes?|appreciates?|understands?|is interested|cares about|is engaged|is thoughtful|is knowledgeable|knows (their )?stuff|gets it)\b/i;

export function isSubstantiveProfileClick(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length < PROFILE_CLICK_MIN_WORDS) return false;
  return !NO_ONE_IN_PARTICULAR.test(trimmed);
}
