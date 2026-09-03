import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TweetRow } from "@/lib/getx/tweet";
import {
  buildMockAudiencePage,
  fetchReplies,
  fetchRetweeters,
  parseMockAudienceCursor,
  type AudiencePage,
} from "@/lib/getx/audience";

type SourceType = "replied" | "retweeted";

function isSourceType(value: unknown): value is SourceType {
  return value === "replied" || value === "retweeted";
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
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const tweetId = typeof record?.tweet_id === "string" ? record.tweet_id : null;
  const sourceType = isSourceType(record?.source_type) ? record.source_type : null;
  const cursor = typeof record?.cursor === "string" ? record.cursor : null;

  if (!tweetId || !sourceType) {
    return NextResponse.json(
      { error: "Missing or invalid tweet_id/source_type." },
      { status: 400 },
    );
  }

  const { data: tweet, error: tweetError } = await supabase
    .from("tweets")
    .select("*")
    .eq("id", tweetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (tweetError) {
    console.error("tweets/pull-audience failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to pull that tweet's audience. Please try again." },
      { status: 502 },
    );
  }

  if (!tweet) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  const tweetRow = tweet as TweetRow;

  let page: AudiencePage;
  try {
    if (process.env.GETX_API_KEY) {
      const live =
        sourceType === "replied"
          ? await fetchReplies(tweetRow.x_tweet_id, cursor)
          : await fetchRetweeters(tweetRow.x_tweet_id, cursor);
      page = live;
    } else {
      page = buildMockAudiencePage(parseMockAudienceCursor(cursor), sourceType);
    }
  } catch (error) {
    console.error(
      "tweets/pull-audience failed to fetch audience page",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to pull that tweet's audience. Please try again.",
      },
      { status: 502 },
    );
  }

  if (page.members.length === 0) {
    return NextResponse.json({
      leads: [],
      peopleFound: 0,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  const rows = page.members.map((member) => ({
    user_id: user.id,
    x_username: member.handle,
    name: member.name,
    bio: member.bio,
    followers_count: member.followersCount,
    tweet_id: tweetRow.id,
    source: sourceType,
    status: "new",
    reply_tweet_id: member.replyTweetId,
    reply_text: member.replyText,
  }));

  const { data: inserted, error: upsertError } = await supabase
    .from("leads")
    .upsert(rows, { onConflict: "user_id,x_username", ignoreDuplicates: true })
    .select();

  if (upsertError) {
    console.error("tweets/pull-audience failed to upsert leads", upsertError);
    return NextResponse.json(
      { error: "Failed to save that page of leads. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    leads: inserted ?? [],
    peopleFound: page.members.length,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}
