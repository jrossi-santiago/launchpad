import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TweetRow } from "@/lib/getx/tweet";
import { XConnectionError, likeAs, type XConnectionRow } from "@/lib/x/writer";
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
    console.error("tweets/like failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to like that tweet. Please try again." },
      { status: 502 },
    );
  }

  if (!tweet) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  const tweetRow = tweet as TweetRow;

  const { data: existingLike, error: existingLikeError } = await supabase
    .from("actions")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "success")
    .eq("action_type", "like")
    .eq("target_tweet_id", tweetRow.id)
    .maybeSingle();

  if (existingLikeError) {
    console.error("tweets/like failed to check existing actions", existingLikeError);
    return NextResponse.json(
      { error: "Failed to like that tweet. Please try again." },
      { status: 502 },
    );
  }

  if (existingLike) {
    return NextResponse.json(
      { error: "You've already liked this tweet." },
      { status: 409 },
    );
  }

  const usage = await getActionUsage(supabase, user.id, "like");
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} likes for today. Try again tomorrow.`,
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
    console.error("tweets/like failed to load connection", connectionError);
    return NextResponse.json(
      { error: "Failed to like that tweet. Please try again." },
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
      action_type: "like",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "failed",
    });
    if (error) console.error("tweets/like failed to record failed action", error);
  }

  try {
    const result = await likeAs(supabase, connection as XConnectionRow, tweetRow.x_tweet_id);
    if (!result.liked) {
      throw new Error("X did not confirm the like.");
    }

    const { error: actionError } = await supabase.from("actions").insert({
      user_id: user.id,
      action_type: "like",
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

    const updatedUsage = await getActionUsage(supabase, user.id, "like");

    return NextResponse.json({ liked: true, usage: updatedUsage });
  } catch (error) {
    console.error(
      "tweets/like failed",
      error instanceof Error ? error.message : error,
    );
    await recordFailedAction();
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to like that tweet. Please try again.",
      },
      { status: error instanceof XConnectionError ? 400 : 502 },
    );
  }
}
