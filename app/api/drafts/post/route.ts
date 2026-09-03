import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DraftRow } from "@/lib/anthropic/drafts";
import type { TweetRow } from "@/lib/getx/tweet";
import { buildMockPostReply, postReply } from "@/lib/getx/postReply";
import { decryptToken } from "@/lib/security/tokenCrypto";
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
  const draftId =
    body && typeof body === "object" && typeof (body as { draft_id?: unknown }).draft_id === "string"
      ? (body as { draft_id: string }).draft_id
      : null;

  if (!draftId) {
    return NextResponse.json({ error: "Missing draft_id." }, { status: 400 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (draftError) {
    console.error("drafts/post failed to load draft", draftError);
    return NextResponse.json(
      { error: "Failed to post that reply. Please try again." },
      { status: 502 },
    );
  }

  if (!draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  const draftRow = draft as DraftRow;

  if (draftRow.status === "posted") {
    return NextResponse.json(
      { error: "This draft has already been posted." },
      { status: 409 },
    );
  }

  const { data: tweet, error: tweetError } = await supabase
    .from("tweets")
    .select("*")
    .eq("id", draftRow.tweet_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (tweetError) {
    console.error("drafts/post failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to post that reply. Please try again." },
      { status: 502 },
    );
  }

  if (!tweet) {
    return NextResponse.json({ error: "Tweet not found." }, { status: 404 });
  }

  const tweetRow = tweet as TweetRow;

  const { data: siblingPosted, error: siblingError } = await supabase
    .from("drafts")
    .select("id")
    .eq("tweet_id", tweetRow.id)
    .eq("status", "posted")
    .maybeSingle();

  if (siblingError) {
    console.error("drafts/post failed to check sibling drafts", siblingError);
    return NextResponse.json(
      { error: "Failed to post that reply. Please try again." },
      { status: 502 },
    );
  }

  if (siblingPosted) {
    return NextResponse.json(
      { error: "A reply has already been posted for this tweet." },
      { status: 409 },
    );
  }

  const { data: connection, error: connectionError } = await supabase
    .from("x_connections")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connectionError) {
    console.error("drafts/post failed to load connection", connectionError);
    return NextResponse.json(
      { error: "Failed to post that reply. Please try again." },
      { status: 502 },
    );
  }

  if (!connection || !connection.x_handle) {
    return NextResponse.json(
      { error: "Connect your X account in Settings first." },
      { status: 400 },
    );
  }

  const usage = await getActionUsage(supabase, user.id, "reply");
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've used all ${usage.limit} replies for today. Try again tomorrow.`,
        usage,
      },
      { status: 429 },
    );
  }

  const userId = user.id;

  async function recordFailedAction() {
    const { error } = await supabase.from("actions").insert({
      user_id: userId,
      action_type: "reply",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "failed",
    });
    if (error) console.error("drafts/post failed to record failed action", error);
  }

  let authToken: string;
  let ct0: string;
  try {
    authToken = decryptToken(connection.auth_token_encrypted);
    ct0 = decryptToken(connection.ct0_encrypted);
  } catch (error) {
    console.error("drafts/post failed to decrypt connection", error);
    await recordFailedAction();
    return NextResponse.json(
      { error: "Your X connection needs to be reconnected in Settings." },
      { status: 400 },
    );
  }

  try {
    const replyText = draftRow.draft_text ?? "";
    const result = process.env.GETX_API_KEY
      ? await postReply(authToken, ct0, tweetRow.x_tweet_id, replyText)
      : buildMockPostReply(tweetRow.x_tweet_id);

    const nowIso = new Date().toISOString();

    const { data: updatedDraft, error: updateDraftError } = await supabase
      .from("drafts")
      .update({
        status: "posted",
        posted_text: replyText,
        posted_at: nowIso,
        posted_x_tweet_id: result.postedTweetId,
      })
      .eq("id", draftRow.id)
      .select()
      .single();

    if (updateDraftError) throw updateDraftError;

    const { error: updateTweetError } = await supabase
      .from("tweets")
      .update({ status: "actioned" })
      .eq("id", tweetRow.id);

    if (updateTweetError) throw updateTweetError;

    const { error: actionError } = await supabase.from("actions").insert({
      user_id: user.id,
      action_type: "reply",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "success",
    });

    if (actionError) throw actionError;

    return NextResponse.json({
      draft: updatedDraft,
      permalink: `https://x.com/i/status/${result.postedTweetId}`,
    });
  } catch (error) {
    console.error(
      "drafts/post failed",
      error instanceof Error ? error.message : error,
    );
    await recordFailedAction();
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to post that reply. Please try again.",
      },
      { status: 502 },
    );
  }
}
