import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isProof, type Proof } from "@/lib/anthropic/proofs";

// Proofs are saved on their own rather than through /api/brand-pack/save,
// because they are the one part of the pack the model never writes: the
// interview generates positioning, ICP, voice and templates, and a
// generated "proof" would be exactly the invented number this whole thing
// exists to stop. These only ever come from the founder typing them.
const MAX_PROOFS = 40;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const raw = body && typeof body === "object" ? (body as { proofs?: unknown }).proofs : null;

  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "proofs must be a list." }, { status: 400 });
  }

  if (raw.length > MAX_PROOFS) {
    return NextResponse.json(
      { error: `That's more than ${MAX_PROOFS} proofs. Keep the ones you'd actually cite.` },
      { status: 400 },
    );
  }

  if (!raw.every(isProof)) {
    return NextResponse.json(
      { error: "Every proof needs a kind, some text, and the rest of its fields." },
      { status: 400 },
    );
  }

  const proofs: Proof[] = (raw as Proof[])
    .filter((proof) => proof.text.trim().length > 0)
    .map((proof) => ({
      id: proof.id,
      kind: proof.kind,
      text: proof.text.trim(),
      number: proof.number.trim(),
      attribution: proof.attribution.trim(),
      // Something you only watched is never yours to tell in first
      // person, whatever the form said. Normalised here so the writer
      // never has to second-guess the flag.
      first_person_ok: proof.kind === "lived" && proof.first_person_ok,
    }));

  const withoutAttribution = proofs.find(
    (proof) => proof.kind === "witnessed" && proof.attribution.length === 0,
  );

  if (withoutAttribution) {
    return NextResponse.json(
      {
        error:
          "A witnessed proof needs a name attached — it goes in the comment as plain text, and without it the story reads as yours.",
      },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from("brand_packs")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Create your Brand Pack first." },
      { status: 400 },
    );
  }

  const { data: saved, error } = await supabase
    .from("brand_packs")
    .update({ proofs })
    .eq("id", existing.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("brand-pack/proofs save failed", error);
    return NextResponse.json(
      { error: "Couldn't save your proofs. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json(saved);
}
