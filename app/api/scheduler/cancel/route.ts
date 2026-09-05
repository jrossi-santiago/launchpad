import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Pulls a post before it goes. Canceled rather than deleted: the text is
// often worth keeping, and a row that vanished is indistinguishable from
// one that was never saved.
//
// A row the worker is mid-send on (`claimed`) cannot be canceled — by
// then the request to X may already be in flight, and a cancel that
// leaves the post live on X while the dashboard says "canceled" is worse
// than no cancel at all.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const id =
    body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id
      : null;

  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .in("status", ["draft", "scheduled", "failed"])
    .select()
    .maybeSingle();

  if (error) {
    console.error("scheduler/cancel failed", error);
    return NextResponse.json({ error: "Could not cancel that post." }, { status: 502 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "That post is already going out or has gone out." },
      { status: 409 },
    );
  }

  return NextResponse.json({ post: data });
}
