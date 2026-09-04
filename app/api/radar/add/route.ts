import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertTweetRow, type FetchedTweet, type TweetMetrics } from "@/lib/getx/tweet";

function isTweetMetrics(value: unknown): value is TweetMetrics {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.like_count === "number" &&
    typeof m.retweet_count === "number" &&
    typeof m.reply_count === "number"
  );
}

function isFetchedTweet(value: unknown): value is FetchedTweet {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.x_tweet_id === "string" &&
    typeof t.author_handle === "string" &&
    typeof t.content === "string" &&
    typeof t.url === "string" &&
    typeof t.engagement_score === "number" &&
    isTweetMetrics(t.metrics)
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!isFetchedTweet(body)) {
    return NextResponse.json(
      { error: "Missing or invalid tweet payload." },
      { status: 400 },
    );
  }

  try {
    const tweet = await upsertTweetRow(supabase, user.id, body);
    return NextResponse.json({ tweet });
  } catch (error) {
    console.error("radar/add failed", error);
    return NextResponse.json(
      { error: "Failed to add that tweet. Please try again." },
      { status: 502 },
    );
  }
}
