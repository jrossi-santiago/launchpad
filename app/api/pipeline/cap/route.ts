import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { countLive } from "@/lib/pipeline/board";
import { effectiveLiveCap, LIVE_CAP } from "@/lib/pipeline/rules";

// How many people you work at once. Five by default, ten at the most —
// at three comments each, two days apart, ten live is more commenting
// than a person does on top of Room 1.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const raw = body && typeof body === "object" ? (body as { cap?: unknown }).cap : null;

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return NextResponse.json({ error: "cap must be a number." }, { status: 400 });
  }

  const cap = effectiveLiveCap(raw);
  if (cap !== Math.floor(raw)) {
    return NextResponse.json(
      { error: `Pick a number between 1 and ${LIVE_CAP}.` },
      { status: 400 },
    );
  }

  // Lowering the cap never evicts anyone: it just stops new promotions
  // until Replace brings the room back under the new number.
  const liveCount = await countLive(supabase, user.id);

  const { error } = await supabase
    .from("users")
    .update({ pipeline_live_cap: cap })
    .eq("id", user.id);

  if (error) {
    console.error("pipeline/cap update failed", error);
    return NextResponse.json(
      { error: "Couldn't save that. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ cap, live_count: liveCount });
}
