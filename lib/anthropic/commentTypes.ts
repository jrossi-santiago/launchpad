// The four comment types, as rules rather than as advice.
//
// Every generator in the app already said "add something of your own" in
// prose, and prose is exactly what a model rounds off. "Add something"
// becomes a sentence of agreement with a hedge on the end, and it passes
// every check we had, because the only thing being checked was length.
//
// The commenter system this app is built on names four comments that are
// worth writing under someone else's post, and each of them has a shape
// you can actually test for: an operator add-on carries a number, a
// receipts story is something that happened to you, a counterpoint names
// the scope where the post holds before naming the one where it does not,
// and a sharp question ends in a question mark and asks something worth
// answering. So the type is chosen before the comment is written, it is
// generated as its own tool field, and `violatesTypeRule()` sends the
// comment back when the shape it promised is not there.
//
// The four are also exhaustive on purpose. A comment that is none of them
// — "great post", "so true", agreeing at length — is the comment this
// whole feature exists to stop, and there is no fifth option to escape
// into. Sharp question is the floor: there is always something you
// genuinely want to know.

export const COMMENT_TYPE_IDS = [
  "operator",
  "receipts",
  "counterpoint",
  "question",
] as const;

export type CommentType = (typeof COMMENT_TYPE_IDS)[number];

export type CommentTypeSpec = {
  id: CommentType;
  // What the card calls it.
  label: string;
  // The one line under the label, for the founder rather than the model.
  blurb: string;
  // When this type is the right pick — written as the condition, so the
  // model is choosing against a test rather than a vibe.
  when: string;
  // What the comment must contain to be this type.
  shape: string;
  // The example from the system doc, kept verbatim: these are the four
  // comments the whole thing is modelled on, and paraphrasing them into
  // house style is how the shape gets lost.
  example: string;
};

export const COMMENT_TYPES: readonly CommentTypeSpec[] = [
  {
    id: "operator",
    label: "Operator add-on",
    blurb: "One thing you tried, and the number it moved",
    when: "You have done the specific thing the post is about and know what happened, with a number attached.",
    shape:
      "Name the change you made and the number it moved, in that order. It must contain a real figure — a percentage, a count, a price, a duration. No number means this is not an operator add-on.",
    example:
      "We cut onboarding from 7 steps to 3. Activation went 31% → 44% in two weeks. The step we deleted was the one everyone assumed was necessary.",
  },
  {
    id: "receipts",
    label: "Receipts story",
    blurb: "Something that happened to you, with the number and the miss",
    when: "You have lived the thing the post is about, and the useful part is what happened to you rather than a rule you can state.",
    shape:
      "First person, past tense, one scene: what you did, what it cost or returned, what you had wrong. Carries a figure. A miss travels further than a win, so prefer the one that went badly.",
    example:
      "Priced the first template at $9 out of fear. Raised to $29 after three sales. Conversion barely moved. The fear was bigger than the price sensitivity.",
  },
  {
    id: "counterpoint",
    label: "Respectful counterpoint",
    blurb: "True here, not there — and you know the there",
    when: "The post is right inside its own scope and wrong just outside it, and you know the outside case first-hand.",
    shape:
      "Grant the scope where it holds, then name the scope where it does not and why the mechanism changes. Challenge the scope, never the person: no 'wrong', no 'actually', no correcting their reasoning.",
    example:
      "This is true for B2C. In B2B the buyer is not the user, so shipping weekly can increase churn if the champion has to re-sell internally every sprint.",
  },
  {
    id: "question",
    label: "Sharp question",
    blurb: "The question whose answer you actually want",
    when: "You have no first-hand result to add, but there is something specific about what they did that you genuinely want to know.",
    shape:
      "One question, ending in a question mark, naming the specific thing being asked about — the measure, the number, the decision. Never 'thoughts?', 'curious?', 'any tips?', or a question you could answer yourself.",
    example:
      "How are you measuring that? We used weekly active and it lied until we switched to 'did the job they paid for in the first 48 hours'.",
  },
];

const BY_ID = new Map(COMMENT_TYPES.map((spec) => [spec.id, spec]));

export function isCommentType(value: unknown): value is CommentType {
  return typeof value === "string" && BY_ID.has(value as CommentType);
}

export function commentTypeSpec(type: CommentType): CommentTypeSpec {
  return BY_ID.get(type)!;
}

export function commentTypeLabel(value: unknown): string | null {
  return isCommentType(value) ? BY_ID.get(value)!.label : null;
}

// The tool field. It sits before the comment in the schema, because tool
// arguments come back in schema order and the choice has to be made
// before the thing it constrains is written — the same mechanism `point`
// runs on. A type picked after the fact is a label, not a decision.
export const COMMENT_TYPE_FIELD = {
  type: "string",
  enum: [...COMMENT_TYPE_IDS],
  description: COMMENT_TYPES.map(
    (spec) => `${spec.id} = ${spec.when} ${spec.shape}`,
  ).join(" | "),
} as const;

// The selection rules, in the order they are applied. Priority is the
// point: a post you have a number for gets the number, every time, and
// the question is the floor rather than the easy way out.
export const COMMENT_TYPE_RULES = [
  "Pick the type of comment this post can carry, before writing anything. Exactly one of four, in this order of preference — take the first that is honestly true:",
  ...COMMENT_TYPES.map(
    (spec) => `- \`${spec.id}\` (${spec.label}): ${spec.when} ${spec.shape}`,
  ),
  "Work down that list. `operator` beats `receipts` when you have both, and either beats `counterpoint` or `question`. Never pick a type whose shape you cannot actually fill: an operator add-on with no number, or a receipts story you did not live, is a lie, and the lie is worse than a smaller comment.",
  "`question` is the floor, not the escape hatch. If nothing else is honestly available you always have one real question — but it must be a specific one, and 'thoughts?' is not a comment.",
  "There is no fifth type. If the only thing you can say is that the post is right, you have nothing, and agreeing at length is the comment this exists to prevent.",
  "",
  "Write the comment in the shape of the type you picked. The examples below are what each one looks like — match their shape, never their content:",
  ...COMMENT_TYPES.map((spec) => `- ${spec.id}: ${spec.example}`),
];

// Enforcement. Each rule is the cheapest test that catches the failure it
// is aimed at, and each returns the sentence the corrective retry is
// given — a model told "not usable" guesses, a model told "an operator
// add-on needs a figure" fixes the actual thing.
//
// These are deliberately shallow. No regex can tell whether a number is
// true, or whether the scope named in a counterpoint is the right one;
// what they can tell is whether the comment has the shape the model just
// claimed it was writing, which is where the slide back into agreement
// shows up first.
const HAS_FIGURE = /\d/;

// "I", "we", "my" — the ordinary way of marking a story as yours.
const FIRST_PERSON = /\b(i|i'?m|i'?ve|we|we'?re|we'?ve|my|our|us)\b/i;

// The other way, and the one the system doc's own example uses: an
// implied subject. "Priced the first template at $9 out of fear. Raised
// to $29 after three sales." is first person with the "I" left off, which
// is how people actually type on X — so a story that opens on a past-
// tense verb counts as yours too. Irregulars are listed because -ed does
// not catch them.
const OPENS_PAST_TENSE =
  /^[^a-z]*([a-z]+ed|ran|sold|built|went|got|made|paid|took|put|cut|spent|lost|hit|wrote|began|kept|left|sent|gave|found|grew|drove|threw|broke|bought|taught|thought|told|held|ran)\b/i;

// A counterpoint has to turn somewhere. Two shapes count: an explicit
// contrast word, or granting the scope first — "this is true for B2C. In
// B2B…" — which is the doc's example and is the better-mannered version
// of the same move.
const CONTRAST =
  /\b(but|though|although|unless|whereas|except|however|other way|opposite|different|not for|less true|breaks down|depends|only when|only if)\b/i;
const SCOPE_SHIFT =
  /\b(true|works|holds|right|fine|the case|applies)\b[^.!?]{0,60}\b(for|in|with|when|at)\b/i;

// Questions that are a way of saying nothing while ending in "?".
const EMPTY_QUESTION =
  /^(thoughts|curious|any tips|tips|how|why|what|really|is this|isn'?t it|right)\s*\??$/i;

export function violatesTypeRule(
  type: CommentType,
  comment: string,
): string | null {
  const text = comment.trim();

  switch (type) {
    case "operator":
      if (!HAS_FIGURE.test(text)) {
        return "An operator add-on has to carry the actual number — the percentage, the count, the price, the duration. Add the figure, or pick a different type.";
      }
      return null;

    case "receipts":
      if (!FIRST_PERSON.test(text) && !OPENS_PAST_TENSE.test(text)) {
        return "A receipts story is something that happened to you: first person, past tense, one scene. Write it as yours, or pick a different type.";
      }
      if (!HAS_FIGURE.test(text)) {
        return "A receipts story carries a figure — what it cost, what it returned, how long it took. Add it, or pick a different type.";
      }
      return null;

    case "counterpoint":
      if (!CONTRAST.test(text) && !SCOPE_SHIFT.test(text)) {
        return "A counterpoint has to name both scopes: where the post holds, and where it stops holding. Grant the first, then turn — or pick a different type.";
      }
      return null;

    case "question":
      if (!text.includes("?")) {
        return "A sharp question ends in a question mark. Ask the thing you actually want to know, or pick a different type.";
      }
      if (EMPTY_QUESTION.test(text) || text.split(/\s+/).length < 5) {
        return "That question asks nothing. Name the specific thing you want to know — the measure, the number, the decision behind it.";
      }
      return null;
  }
}
