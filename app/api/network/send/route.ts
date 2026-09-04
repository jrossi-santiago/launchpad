import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertTweetRow, type FetchedTweet, type TweetMetrics } from "@/lib/getx/tweet";

type CardRow = {
  id: string;
  x_tweet_id: string;
  content: string | null;
  url: string | null;
  metrics: unknown;
  engagement_score: number | null;
  state: string;
  network_profiles: { handle: string } | { handle: string }[] | null;
};

function toMetrics(value: unknown): TweetMetrics {
  if (!value || typeof value !== "object") {
    return { like_count: 0, retweet_count: 0, reply_count: 0 };
  }
  const m = value as Record<string, unknown>;
  return {
    like_count: typeof m.like_count === "number" ? m.like_count : 0,
    retweet_count: typeof m.retweet_count === "number" ? m.retweet_count : 0,
    reply_count: typeof m.reply_count === "number" ? m.reply_count : 0,
  };
}

function handleOf(row: CardRow): string | null {
  const joined = Array.isArray(row.network_profiles)
    ? row.network_profiles[0]
    : row.network_profiles;
  return joined?.handle ?? null;
}

// Sends one card into the Launchpad queue. This is deliberately the same
// upsertTweetRow() that POST /api/radar/add uses, so a card from Network
// and a result from Radar land in the queue identically; the client then
// calls POST /api/drafts/regenerate exactly as Radar does.
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

  const { data: card, error: lookupError } = await supabase
    .from("network_tweets")
    .select("id, x_tweet_id, content, url, metrics, engagement_score, state, network_profiles(handle)")
    .eq("user_id", user.id)
    .eq("id", cardId)
    .maybeSingle();

  if (lookupError) {
    console.error("network/send lookup failed", lookupError);
    return NextResponse.json({ error: "Failed to send that post." }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "That post isn't in your Network." }, { status: 404 });
  }

  const row = card as CardRow;
  const handle = handleOf(row);

  const fetched: FetchedTweet = {
    x_tweet_id: row.x_tweet_id,
    author_handle: handle ? `@${handle}` : "@unknown",
    content: row.content ?? "",
    url: row.url ?? `https://x.com/i/status/${row.x_tweet_id}`,
    metrics: toMetrics(row.metrics),
    engagement_score: row.engagement_score ?? 0,
  };

  try {
    const tweet = await upsertTweetRow(supabase, user.id, fetched);

    const { error: updateError } = await supabase
      .from("network_tweets")
      .update({ state: "sent", tweet_id: tweet.id })
      .eq("id", row.id)
      .eq("user_id", user.id);

    if (updateError) throw updateError;

    return NextResponse.json({ tweet });
  } catch (error) {
    console.error("network/send failed", error);
    return NextResponse.json({ error: "Failed to send that post." }, { status: 502 });
  }
}
