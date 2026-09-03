import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import type { TweetRow } from "@/lib/getx/tweet";
import { buildMockDrafts, callHaiku, insertDrafts } from "@/lib/anthropic/drafts";
import { getRegenerationUsage, recordRegeneration } from "@/lib/usage/regenerations";

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
      { error: "Build your Brand Pack before regenerating drafts." },
      { status: 400 },
    );
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
    console.error("drafts/regenerate failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to regenerate drafts. Please try again." },
      { status: 502 },
    );
  }

  if (!tweet) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  const usage = await getRegenerationUsage(supabase, user.id);
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} regenerations for today. Try again tomorrow.`,
        usage,
      },
      { status: 429 },
    );
  }

  try {
    const draftTexts = process.env.ANTHROPIC_API_KEY
      ? await callHaiku(brandPack as BrandPackRow, tweet as TweetRow)
      : buildMockDrafts(brandPack as BrandPackRow, tweet as TweetRow);

    const { error: deleteError } = await supabase
      .from("drafts")
      .delete()
      .eq("tweet_id", tweet.id);

    if (deleteError) throw deleteError;

    const drafts = await insertDrafts(supabase, user.id, tweet.id, draftTexts);

    await recordRegeneration(supabase, user.id, tweet.id);
    const updatedUsage = await getRegenerationUsage(supabase, user.id);

    return NextResponse.json({ drafts, usage: updatedUsage });
  } catch (error) {
    console.error("drafts/regenerate failed", error);
    return NextResponse.json(
      { error: "Failed to regenerate drafts. Please try again." },
      { status: 502 },
    );
  }
}
