import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DraftRow } from "@/lib/anthropic/drafts";
import type { TweetRow } from "@/lib/getx/tweet";

// Marks a draft as posted without calling GetXAPI — for a reply you copied
// and sent yourself, by hand, in your own browser. No X connection, no
// auth_token/ct0, no API call: nothing here is distinguishable from you
// just using X normally, so it carries none of the automation risk the
// "Post" button's live API call does. action_type is "reply_manual", not
// "reply", so this never counts against the daily reply cap in
// lib/usage/actions.ts — that cap exists to bound automated API calls,
// and this isn't one.
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
    console.error("drafts/mark-posted failed to load draft", draftError);
    return NextResponse.json(
      { error: "Failed to mark that draft as posted. Please try again." },
      { status: 502 },
    );
  }

  if (!draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  const draftRow = draft as DraftRow;

  if (draftRow.status === "posted") {
    return NextResponse.json(
      { error: "This draft has already been marked as posted." },
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
    console.error("drafts/mark-posted failed to load tweet", tweetError);
    return NextResponse.json(
      { error: "Failed to mark that draft as posted. Please try again." },
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
    console.error("drafts/mark-posted failed to check sibling drafts", siblingError);
    return NextResponse.json(
      { error: "Failed to mark that draft as posted. Please try again." },
      { status: 502 },
    );
  }

  if (siblingPosted) {
    return NextResponse.json(
      { error: "A reply has already been marked as posted for this tweet." },
      { status: 409 },
    );
  }

  try {
    const replyText = draftRow.draft_text ?? "";
    const nowIso = new Date().toISOString();

    const { data: updatedDraft, error: updateDraftError } = await supabase
      .from("drafts")
      .update({
        status: "posted",
        posted_text: replyText,
        posted_at: nowIso,
        posted_x_tweet_id: null,
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
      action_type: "reply_manual",
      target_tweet_id: tweetRow.id,
      target_username: tweetRow.author_handle,
      status: "success",
    });

    if (actionError) throw actionError;

    return NextResponse.json({ draft: updatedDraft });
  } catch (error) {
    console.error(
      "drafts/mark-posted failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to mark that draft as posted. Please try again." },
      { status: 502 },
    );
  }
}
