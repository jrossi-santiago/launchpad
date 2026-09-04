import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TweetRow } from "@/lib/getx/tweet";
import { XConnectionError, followAs, type XConnectionRow } from "@/lib/x/writer";
import { getActionUsage } from "@/lib/usage/actions";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tweetId =
    body && typeof body === "object" && typeof (body as { tweet_id?: unknown }).tweet_id === "string"
      ? (body as { tweet_id: string }).tweet_id
      : null;

  if (!tweetId) {
    return NextResponse.json({ error: "Missing tweet_id." }, { status: 400 });
  }

  const { data: tweet, error: tweetError } = await supabase
    .from("tweets")
    .select("*")
    .eq("id", tweetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (tweetError) {
    console.error("tweets/follow failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to follow that author. Please try again." },
      { status: 502 },
    );
  }

  if (!tweet) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  const tweetRow = tweet as TweetRow;

  if (!tweetRow.author_handle) {
    return NextResponse.json(
      { error: "This tweet has no known author to follow." },
      { status: 400 },
    );
  }

  // Any tweet by this author counts, not just this one — a follow is
  // per-author, not per-tweet.
  const { data: existingFollow, error: existingFollowError } = await supabase
    .from("actions")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "success")
    .eq("action_type", "follow")
    .eq("target_username", tweetRow.author_handle)
    .maybeSingle();

  if (existingFollowError) {
    console.error("tweets/follow failed to check existing actions", existingFollowError);
    return NextResponse.json(
      { error: "Failed to follow that author. Please try again." },
      { status: 502 },
    );
  }

  if (existingFollow) {
    return NextResponse.json(
      { error: "You're already following this author." },
      { status: 409 },
    );
  }

  const usage = await getActionUsage(supabase, user.id, "follow");
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} follows for today. Try again tomorrow.`,
        usage,
      },
      { status: 429 },
    );
  }

  const { data: connection, error: connectionError } = await supabase
    .from("x_connections")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connectionError) {
    console.error("tweets/follow failed to load connection", connectionError);
    return NextResponse.json(
      { error: "Failed to follow that author. Please try again." },
      { status: 502 },
    );
  }

  if (!connection || !connection.x_handle) {
    return NextResponse.json(
      { error: "Connect your X account in Settings first." },
      { status: 400 },
    );
  }

  const userId = user.id;

  async function recordFailedAction() {
    const { error } = await supabase.from("actions").insert({
      user_id: userId,
      action_type: "follow",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "failed",
    });
    if (error) console.error("tweets/follow failed to record failed action", error);
  }

  // Both write providers want a bare screen name; author_handle is stored
  // with a leading "@" (see lib/getx/tweet.ts).
  const username = tweetRow.author_handle.replace(/^@/, "");

  try {
    const result = await followAs(supabase, connection as XConnectionRow, username);
    // A protected account answers with pending:true and following:false —
    // the follow request was sent, so that is a success, not a failure.
    if (!result.following && !result.pending) {
      throw new Error("X did not confirm the follow.");
    }

    const { error: actionError } = await supabase.from("actions").insert({
      user_id: user.id,
      action_type: "follow",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "success",
    });

    if (actionError) throw actionError;

    const { error: updateTweetError } = await supabase
      .from("tweets")
      .update({ status: "actioned" })
      .eq("id", tweetRow.id);

    if (updateTweetError) throw updateTweetError;

    const updatedUsage = await getActionUsage(supabase, user.id, "follow");

    return NextResponse.json({
      following: true,
      // Surfaced so the UI can say "request sent" for a protected account
      // rather than claiming an established follow.
      pending: result.pending,
      authorHandle: tweetRow.author_handle,
      usage: updatedUsage,
    });
  } catch (error) {
    console.error(
      "tweets/follow failed",
      error instanceof Error ? error.message : error,
    );
    await recordFailedAction();
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to follow that author. Please try again.",
      },
      { status: error instanceof XConnectionError ? 400 : 502 },
    );
  }
}
