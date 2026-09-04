import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseHandle } from "@/lib/getx/userTweets";
import { pollProfile } from "@/lib/network/poll";
import { loadStacks, MAX_PROFILES, type NetworkProfileRow } from "@/lib/network/stack";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const input =
    body && typeof body === "object" && typeof (body as { handle?: unknown }).handle === "string"
      ? (body as { handle: string }).handle
      : "";

  const handle = parseHandle(input);
  if (!handle) {
    return NextResponse.json(
      { error: "That doesn't look like an X handle or profile URL." },
      { status: 400 },
    );
  }

  const { count, error: countError } = await supabase
    .from("network_profiles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    console.error("network/add count failed", countError);
    return NextResponse.json({ error: "Failed to add that account." }, { status: 500 });
  }

  if ((count ?? 0) >= MAX_PROFILES) {
    return NextResponse.json(
      {
        error: `You're watching the maximum of ${MAX_PROFILES} accounts. Remove one to add another.`,
      },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("network_profiles")
    .insert({ user_id: user.id, handle })
    .select()
    .single();

  if (insertError) {
    // 23505 is Postgres' unique_violation, i.e. the handle is already in
    // this user's Network.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: `You're already watching @${handle}.` },
        { status: 409 },
      );
    }
    console.error("network/add insert failed", insertError);
    return NextResponse.json({ error: "Failed to add that account." }, { status: 500 });
  }

  const profile = inserted as NetworkProfileRow;

  // Forced: the row was created a moment ago, so its TTL check would
  // otherwise be meaningless — and an account added without its first
  // poll is an empty column with no explanation. A failure here is
  // recorded on the profile as last_error rather than thrown: the row
  // stays, and Refresh retries it.
  await pollProfile(supabase, user.id, profile, { force: true });

  const stacks = await loadStacks(supabase, user.id);
  return NextResponse.json({ stacks });
}
