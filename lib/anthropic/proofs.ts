import type { CommentType } from "@/lib/anthropic/commentTypes";

// What a comment is allowed to claim.
//
// `violatesTypeRule` checks that an operator add-on carries a figure. It
// cannot check that the figure happened, and that is the gap this closes:
// the founder writes their real numbers and real misses down once, and
// the two comment types that rest on evidence are simply not offered when
// there is no evidence to rest them on.
//
// Two kinds, because they carry differently:
//
//   lived      something this founder did. First person is honest.
//   witnessed  a public, checkable scar belonging to someone else. Usable,
//              but only with the attribution attached and never worn as
//              "we" — a borrowed story told in first person is the exact
//              failure this whole module exists to stop.

export type ProofKind = "lived" | "witnessed";

export type Proof = {
  id: string;
  kind: ProofKind;
  // What happened, in the founder's own words.
  text: string;
  // The figure, when there is one: "31% → 44%", "$29", "three weeks".
  // Kept as text because a proof's number is rarely a single scalar.
  number: string;
  // Who it belongs to. Required for witnessed, empty for lived.
  attribution: string;
  // Whether this may be told as "I" / "we". Always false for witnessed.
  first_person_ok: boolean;
};

// The two types that need evidence, and the two that are honest without
// any. A founder with an empty proof list can still write the best
// counterpoint on the post and can always ask the question they actually
// want answered — what they cannot do is produce a result they never got.
export const PROOF_BACKED_TYPES: readonly CommentType[] = ["operator", "receipts"];
export const EVIDENCE_FREE_TYPES: readonly CommentType[] = [
  "counterpoint",
  "question",
];

export function isProof(value: unknown): value is Proof {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.kind === "lived" || v.kind === "witnessed") &&
    typeof v.text === "string" &&
    typeof v.number === "string" &&
    typeof v.attribution === "string" &&
    typeof v.first_person_ok === "boolean"
  );
}

// Brand Pack rows written before this column existed come back with
// undefined, and a row edited by hand can hold anything — so the list is
// filtered rather than trusted. An unparseable proof is dropped, which
// fails closed: fewer proofs means fewer legal types, never more.
export function parseProofs(value: unknown): Proof[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isProof).filter((proof) => proof.text.trim().length > 0);
}

export function livedProofs(proofs: Proof[]): Proof[] {
  return proofs.filter((proof) => proof.kind === "lived");
}

export function witnessedProofs(proofs: Proof[]): Proof[] {
  return proofs.filter(
    (proof) => proof.kind === "witnessed" && proof.attribution.trim().length > 0,
  );
}

// Which comment types this founder may legally write right now. This is
// the whole mechanism: the result narrows the tool's enum, so a type
// without the evidence behind it is not a rule the model is asked to
// follow — it is a value it cannot return.
export function legalCommentTypes(proofs: Proof[]): CommentType[] {
  const hasEvidence = proofs.length > 0;
  return hasEvidence
    ? ["operator", "receipts", "counterpoint", "question"]
    : [...EVIDENCE_FREE_TYPES];
}

// Every number the founder has actually stood behind, normalised for
// comparison: commas out, so "1,200" and "1200" are the same figure.
function figuresIn(text: string): string[] {
  return (text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []);
}

function knownFigures(proofs: Proof[]): Set<string> {
  const figures = new Set<string>();
  for (const proof of proofs) {
    for (const figure of figuresIn(`${proof.text} ${proof.number}`)) {
      figures.add(figure);
    }
  }
  return figures;
}

// The check that catches the invented result. A comment claiming to be an
// operator add-on or a receipts story has to carry a figure the founder
// wrote down — not merely *a* figure, which is all the shape rule can
// ask for.
//
// It is deliberately a one-of test rather than an all-of one. "We cut
// onboarding from 7 steps to 3 and activation went 31% → 44%" legitimately
// contains figures that are not in the proof (the 7 and the 3 may be
// prose the founder never itemised), and demanding every number match
// sends good comments back forever. What it catches is the comment whose
// numbers came from nowhere, which is the actual failure.
export function violatesProofRule(
  type: CommentType,
  comment: string,
  proofs: Proof[],
): string | null {
  if (!PROOF_BACKED_TYPES.includes(type)) return null;

  const usable = type === "receipts" ? livedProofs(proofs) : proofs;

  if (usable.length === 0) {
    return type === "receipts"
      ? "A receipts story has to be something that happened to you, and none is on file. Write a counterpoint or a sharp question instead."
      : "An operator add-on has to carry a number you actually have, and none is on file. Write a counterpoint or a sharp question instead.";
  }

  const known = knownFigures(usable);
  if (known.size === 0) return null;

  const used = figuresIn(comment);
  if (used.length === 0) return null;

  if (!used.some((figure) => known.has(figure))) {
    return `None of those numbers are yours. Use a figure from the proofs you were given — ${[...known].slice(0, 6).join(", ")} — or write a counterpoint or a sharp question instead.`;
  }

  return null;
}

// A witnessed proof told as "we" is the failure worth its own check: it
// is the one that turns a citation into a lie. Only applied when the
// comment could not have come from a lived proof.
const FIRST_PERSON_CLAIM = /\b(i|i'?ve|i'?m|we|we'?ve|we'?re|my|our)\b/i;

export function wearsWitnessedProof(
  comment: string,
  proofs: Proof[],
): string | null {
  if (livedProofs(proofs).length > 0) return null;
  if (witnessedProofs(proofs).length === 0) return null;
  if (!FIRST_PERSON_CLAIM.test(comment)) return null;

  return "That is someone else's result, written as if it were yours. Attribute it in plain text — 'Nevo's two Reddit titles' — or drop it.";
}

// What the model is told it has. Lived proofs come with permission to say
// "I"; witnessed ones come with the attribution and the ban on it.
export function proofRules(proofs: Proof[]): string[] {
  const lived = livedProofs(proofs);
  const witnessed = witnessedProofs(proofs);

  if (lived.length === 0 && witnessed.length === 0) {
    return [
      "",
      "You have no proofs on file. That is not a problem to write around: it decides the type. An operator add-on and a receipts story are not available to you here — do not invent a number, a customer, a revenue figure or a scar to reach for one. Write the counterpoint you can actually defend, or ask the question you actually want answered.",
    ];
  }

  const lines = [
    "",
    "These are the only results, numbers and stories you may claim. Nothing outside this list happened. Inventing a figure, a customer or an outcome is the worst thing you can do here — worse than a smaller comment, worse than declining.",
  ];

  if (lived.length > 0) {
    lines.push(
      "",
      "Yours — first person is honest, and the figures are real:",
      ...lived.map((proof) =>
        proof.number.trim()
          ? `- ${proof.text.trim()} (${proof.number.trim()})`
          : `- ${proof.text.trim()}`,
      ),
    );
  }

  if (witnessed.length > 0) {
    lines.push(
      "",
      "Watched, not lived. Usable, with two conditions: name whose it is in plain text, and never write it as 'I' or 'we'. One name per comment at most, and it has to change what this comment says — a citation that decorates an otherwise identical comment is not worth its space, and you must add the turn yourself: why that scar applies to THIS post.",
      ...witnessed.map((proof) =>
        `- ${proof.attribution.trim()}: ${proof.text.trim()}${proof.number.trim() ? ` (${proof.number.trim()})` : ""}`,
      ),
    );
  }

  if (lived.length === 0) {
    lines.push(
      "",
      "You have no lived proof. A receipts story is therefore not available — it is by definition something that happened to you.",
    );
  }

  return lines;
}

// The compact form that goes in the request body alongside the post, so
// the proofs are data the model reads rather than instructions it obeys.
export function proofPayload(proofs: Proof[]) {
  return proofs.map((proof) => ({
    kind: proof.kind,
    what_happened: proof.text,
    number: proof.number || undefined,
    whose: proof.kind === "witnessed" ? proof.attribution : "yours",
    may_say_i: proof.kind === "lived" && proof.first_person_ok,
  }));
}
