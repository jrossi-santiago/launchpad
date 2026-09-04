import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMockUserTweets, fetchUserTweets, parseHandle } from "@/lib/getx/userTweets";
import { attachMonitor } from "@/lib/network/monitoring";
import {
  ingestTweets,
  loadStacks,
  MAX_PROFILES,
  STACK_LIMIT,
  type NetworkProfileRow,
} from "@/lib/network/stack";

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

  // Backfill first: GetXAPI monitoring is forward-only from the moment a
  // monitor is created, so without this the stack would start empty.
  try {
    const page = process.env.GETX_API_KEY
      ? await fetchUserTweets(handle)
      : buildMockUserTweets(handle);

    await ingestTweets(supabase, user.id, profile.id, page.tweets.slice(0, STACK_LIMIT), "poll");

    const attachment = await attachMonitor(user.id, handle);

    await supabase
      .from("network_profiles")
      .update({
        display_name: page.profile?.displayName ?? null,
        avatar_url: page.profile?.avatarUrl ?? null,
        bio: page.profile?.bio ?? null,
        followers_count: page.profile?.followersCount ?? null,
        last_polled_at: new Date().toISOString(),
        monitor_id: attachment.monitorId,
        monitor_status: attachment.status,
        monitor_error: attachment.error,
      })
      .eq("id", profile.id);
  } catch (error) {
    // The profile row stays: a failed first poll is recoverable with the
    // Refresh button, and deleting it here would lose the monitor state.
    console.error("network/add backfill failed", error);
    await supabase
      .from("network_profiles")
      .update({
        monitor_error:
          error instanceof Error
            ? `Couldn't load posts: ${error.message}`
            : "Couldn't load this account's posts.",
      })
      .eq("id", profile.id);
  }

  const stacks = await loadStacks(supabase, user.id);
  return NextResponse.json({ stacks });
}
