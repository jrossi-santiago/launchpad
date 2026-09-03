import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import {
  buildMockTweet,
  fetchTweetDetail,
  parseStatusId,
  upsertTweetRow,
  type TweetRow,
} from "@/lib/getx/tweet";
import {
  buildMockDrafts,
  callHaiku,
  insertDrafts,
  type DraftRow,
} from "@/lib/anthropic/drafts";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      { error: "Build your Brand Pack before fetching tweets." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const input =
    body && typeof body === "object" && typeof (body as { input?: unknown }).input === "string"
      ? (body as { input: string }).input
      : "";

  const tweetId = parseStatusId(input);
  if (!tweetId) {
    return NextResponse.json(
      { error: "That doesn't look like a tweet URL or numeric tweet ID." },
      { status: 400 },
    );
  }

  try {
    const { data: existingTweet, error: lookupError } = await supabase
      .from("tweets")
      .select("*")
      .eq("user_id", user.id)
      .eq("x_tweet_id", tweetId)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existingTweet) {
      const { data: existingDrafts, error: draftsError } = await supabase
        .from("drafts")
        .select("*")
        .eq("tweet_id", existingTweet.id)
        .order("variant", { ascending: true });

      if (draftsError) throw draftsError;

      return NextResponse.json({
        tweet: existingTweet as TweetRow,
        drafts: (existingDrafts ?? []) as DraftRow[],
      });
    }

    const fetched = process.env.GETX_API_KEY
      ? await fetchTweetDetail(tweetId)
      : buildMockTweet(tweetId);

    const tweetRow = await upsertTweetRow(supabase, user.id, fetched);

    const draftTexts = process.env.ANTHROPIC_API_KEY
      ? await callHaiku(brandPack as BrandPackRow, tweetRow)
      : buildMockDrafts(brandPack as BrandPackRow, tweetRow);

    const drafts = await insertDrafts(
      supabase,
      user.id,
      tweetRow.id,
      draftTexts,
    );

    const { data: draftedTweet, error: statusError } = await supabase
      .from("tweets")
      .update({ status: "drafted" })
      .eq("id", tweetRow.id)
      .select()
      .single();

    if (statusError) throw statusError;

    return NextResponse.json({
      tweet: draftedTweet as TweetRow,
      drafts,
    });
  } catch (error) {
    console.error("tweets/fetch failed", error);
    return NextResponse.json(
      { error: "Failed to fetch that tweet. Please try again." },
      { status: 502 },
    );
  }
}
