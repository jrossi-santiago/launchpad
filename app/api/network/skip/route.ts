import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Skipping keeps the row and flips its state, rather than deleting it.
// That row is what stops the next poll from putting the same post back on
// top of the stack.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const cardId =
    body && typeof body === "object" && typeof (body as { card_id?: unknown }).card_id === "string"
      ? (body as { card_id: string }).card_id
      : "";

  if (!cardId) {
    return NextResponse.json({ error: "Missing card_id." }, { status: 400 });
  }

  const { error } = await supabase
    .from("network_tweets")
    .update({ state: "skipped" })
    .eq("id", cardId)
    .eq("user_id", user.id)
    .eq("state", "new");

  if (error) {
    console.error("network/skip failed", error);
    return NextResponse.json({ error: "Failed to skip that post." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
