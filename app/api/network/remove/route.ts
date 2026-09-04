import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadStacks } from "@/lib/network/stack";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const profileId =
    body && typeof body === "object" && typeof (body as { profile_id?: unknown }).profile_id === "string"
      ? (body as { profile_id: string }).profile_id
      : "";

  if (!profileId) {
    return NextResponse.json({ error: "Missing profile_id." }, { status: 400 });
  }

  const { data: profile, error: lookupError } = await supabase
    .from("network_profiles")
    .select("id")
    .eq("user_id", user.id)
    .eq("id", profileId)
    .maybeSingle();

  if (lookupError) {
    console.error("network/remove lookup failed", lookupError);
    return NextResponse.json({ error: "Failed to remove that account." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "That account isn't in your Network." }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("network_profiles")
    .delete()
    .eq("id", profileId)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("network/remove delete failed", deleteError);
    return NextResponse.json({ error: "Failed to remove that account." }, { status: 500 });
  }

  const stacks = await loadStacks(supabase, user.id);
  return NextResponse.json({ stacks });
}
