"use client";

import { useState } from "react";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  livedProofs,
  parseProofs,
  type Proof,
  type ProofKind,
} from "@/lib/anthropic/proofs";

// The list that decides what a comment is allowed to claim.
//
// The rest of the Brand Pack is written by the interview; this part
// cannot be, because a generated proof is the invented number the whole
// mechanism exists to stop. So it is a plain form, and the empty state
// says what the emptiness costs: with nothing here, the writer can only
// offer counterpoints and questions.
function blankProof(kind: ProofKind): Proof {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    text: "",
    number: "",
    attribution: "",
    first_person_ok: kind === "lived",
  };
}

export function ProofsEditor({
  pack,
  onSaved,
}: {
  pack: BrandPackRow;
  onSaved: (pack: BrandPackRow) => void;
}) {
  const [proofs, setProofs] = useState<Proof[]>(() => parseProofs(pack.proofs));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  const lived = livedProofs(proofs).length;

  function update(id: string, patch: Partial<Proof>) {
    setStatus("idle");
    setProofs((prev) =>
      prev.map((proof) => (proof.id === id ? { ...proof, ...patch } : proof)),
    );
  }

  function add(kind: ProofKind) {
    setStatus("idle");
    setProofs((prev) => [...prev, blankProof(kind)]);
  }

  function remove(id: string) {
    setStatus("idle");
    setProofs((prev) => prev.filter((proof) => proof.id !== id));
  }

  async function save() {
    setStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/brand-pack/proofs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proofs: proofs.filter((proof) => proof.text.trim().length > 0),
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `Save failed (${response.status}).`);
      }

      const saved = body as BrandPackRow;
      setProofs(parseProofs(saved.proofs));
      setStatus("saved");
      onSaved(saved);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Proofs
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        The only results a comment is allowed to claim. Everything the app
        writes for you carries numbers from this list or no numbers at all —
        so a comment can never invent a customer, a revenue figure or a
        result you did not get.
      </p>

      <div
        className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
          lived > 0
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        }`}
      >
        {lived > 0 ? (
          <>
            <strong>All four comment types are available.</strong> With{" "}
            {lived} lived proof{lived === 1 ? "" : "s"} on file, the writer
            can use an operator add-on or a receipts story when a post calls
            for one.
          </>
        ) : (
          <>
            <strong>
              Operator add-ons and receipts stories are switched off.
            </strong>{" "}
            With no lived proof on file, the writer is limited to
            counterpoints and sharp questions — the two types that are honest
            with empty hands. Add one below to unlock the other two.
          </>
        )}
      </div>

      {proofs.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-4">
          {proofs.map((proof) => (
            <li
              key={proof.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    proof.kind === "lived"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {proof.kind === "lived" ? "Yours" : "Watched"}
                </span>
                <button
                  type="button"
                  onClick={() => remove(proof.id)}
                  className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>

              <label className="mt-3 block text-xs text-zinc-500 dark:text-zinc-400">
                What happened
                <textarea
                  rows={2}
                  value={proof.text}
                  onChange={(e) => update(proof.id, { text: e.target.value })}
                  placeholder={
                    proof.kind === "lived"
                      ? "Priced the first template at $9 out of fear. Raised to $29 after three sales, conversion barely moved."
                      : "Two Reddit titles, same post, 40x the traffic on one of them."
                  }
                  className={`mt-1 ${inputClass}`}
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                  The number
                  <input
                    value={proof.number}
                    onChange={(e) => update(proof.id, { number: e.target.value })}
                    placeholder="$9 → $29"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>

                {proof.kind === "witnessed" ? (
                  <label className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Whose it is
                    <input
                      value={proof.attribution}
                      onChange={(e) =>
                        update(proof.id, { attribution: e.target.value })
                      }
                      placeholder="Nevo's two Reddit titles"
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                ) : null}
              </div>

              <p className="mt-2 text-[11px] text-zinc-400">
                {proof.kind === "lived"
                  ? "Written in first person when it's used."
                  : "Named in plain text when it's used, and never written as 'I' or 'we'."}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => add("lived")}
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Add something you did
        </button>
        <button
          type="button"
          onClick={() => add("witnessed")}
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Add something you watched
        </button>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving"}
          className="rounded-full bg-zinc-900 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {status === "saving" ? "Saving…" : "Save proofs"}
        </button>
        {status === "saved" ? (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Saved</span>
        ) : null}
        {status === "error" && error ? (
          <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
        ) : null}
      </div>
    </section>
  );
}
