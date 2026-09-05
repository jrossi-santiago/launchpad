import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Clearing the Feed in one go. Same write as /api/network/skip, once per
// card instead of one card: the rows stay and their state flips, which is
// what keeps the next poll from putting the same posts back on top.
//
// The card ids come from the client rather than being implied by
// "everything new", so what gets cleared is exactly what the person was
// looking at when they pressed the button — a post that arrived in
// between is still there on the next refresh.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const raw =
    body && typeof body === "object" && Array.isArray((body as { card_ids?: unknown }).card_ids)
      ? ((body as { card_ids: unknown[] }).card_ids)
      : null;

  if (!raw) {
    return NextResponse.json({ error: "Missing card_ids." }, { status: 400 });
  }

  const cardIds = Array.from(
    new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0)),
  );

  if (cardIds.length === 0) {
    return NextResponse.json({ ok: true, cleared: 0 });
  }

  const { data, error } = await supabase
    .from("network_tweets")
    .update({ state: "skipped" })
    .in("id", cardIds)
    .eq("user_id", user.id)
    .eq("state", "new")
    .select("id");

  if (error) {
    console.error("network/skip-all failed", error);
    return NextResponse.json({ error: "Failed to clear your Feed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cleared: data?.length ?? 0 });
}
