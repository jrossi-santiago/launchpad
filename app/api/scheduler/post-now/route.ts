import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publishPost } from "@/lib/scheduler/publish";
import {
  getPostUsage,
  validateBody,
  type ScheduledPostRow,
} from "@/lib/scheduler/posts";

// Sends one post immediately, as the signed-in founder.
//
// It goes through the same publishPost() the cron worker uses, and it
// writes the same row — a post sent by hand is not a different kind of
// object from a post sent at 07:00, and giving it its own path would
// mean two places that can send and two places to keep the daily cap in.
//
// The row is created already `claimed` with one attempt spent, so a
// worker run that overlaps this request can never also pick it up.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const body = (payload ?? {}) as Record<string, unknown>;

  const validated = validateBody(body.body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const usage = await getPostUsage(supabase, user.id);
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You've sent all ${usage.limit} posts for today. Schedule this one for tomorrow.`,
        usage,
      },
      { status: 429 },
    );
  }

  const id = typeof body.id === "string" ? body.id : null;
  const nowIso = new Date().toISOString();

  const fields = {
    body: validated.body,
    status: "claimed" as const,
    scheduled_at: nowIso,
    claimed_at: nowIso,
    attempts: 1,
    last_error: null,
    source: body.source === "sharpened" ? "sharpened" : "composer",
    updated_at: nowIso,
  };

  const query = id
    ? supabase
        .from("scheduled_posts")
        .update(fields)
        .eq("id", id)
        .eq("user_id", user.id)
        .in("status", ["draft", "scheduled", "failed"])
    : supabase.from("scheduled_posts").insert({ ...fields, user_id: user.id });

  const { data: row, error } = await query.select().maybeSingle();

  if (error) {
    console.error("scheduler/post-now failed to claim row", error);
    return NextResponse.json({ error: "Could not send that post." }, { status: 502 });
  }

  if (!row) {
    return NextResponse.json(
      { error: "That post is already going out or has gone out." },
      { status: 409 },
    );
  }

  const post = row as ScheduledPostRow;
  const outcome = await publishPost(supabase, post);

  if (!outcome.ok) {
    // publishPost has already written the row's failed state and the
    // reason, so the client only needs the message.
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  return NextResponse.json({
    post_id: post.id,
    permalink: `https://x.com/i/status/${outcome.postedTweetId}`,
    usage: await getPostUsage(supabase, user.id),
  });
}
