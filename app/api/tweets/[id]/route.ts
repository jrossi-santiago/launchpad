import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // drafts.tweet_id has `on delete cascade`, so deleting the tweet removes
  // its drafts automatically — no need to delete them here.
  const { data, error } = await supabase
    .from("tweets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select();

  if (error) {
    console.error("tweets/[id] delete failed", error);
    return NextResponse.json(
      { error: "Failed to delete that tweet. Please try again." },
      { status: 502 },
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
