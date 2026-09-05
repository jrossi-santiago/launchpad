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

// What a comment has to do to be worth the space it takes under someone
// else's post. `point` in the tool schema is the enforcement: it is
// generated before the comment (tool arguments come back in schema
// order), so the model has to name what it is adding before it is allowed
// to add it. Naming nothing is how you catch a comment that agrees with
// the post and stops.
export const POINT_FIELD = {
  type: "string",
  description:
    "The one thing this comment adds that the post does not already contain: a result you got, a case that went the other way, a detail people miss, or a question you actually want answered. One clause, concrete. If you cannot name it, there is no comment to write.",
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
export function isSubstantivePoint(point: string): boolean {
  return point.trim().split(/\s+/).length >= 4;
}

export function isUsableComment(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= COMMENT_MAX;
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
