import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getPostUsage,
  validateBody,
  validateScheduledAt,
  type ScheduledPostRow,
} from "@/lib/scheduler/posts";

// Creates or updates one post. `id` absent means a new row; present
// means the founder edited something already in the queue.
//
// `scheduled_at` absent (or null) saves it as a draft with no time on
// it — deliberately allowed, because "write it now, decide when later"
// is how most of these actually get written.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;

  const validated = validateBody(body.body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const wantsSchedule = typeof body.scheduled_at === "string";
  let scheduledAt: string | null = null;

  if (wantsSchedule) {
    const when = validateScheduledAt(body.scheduled_at);
    if ("error" in when) {
      return NextResponse.json({ error: when.error }, { status: 400 });
    }
    scheduledAt = when.at.toISOString();
  }

  const id = typeof body.id === "string" ? body.id : null;
  const source = body.source === "sharpened" ? "sharpened" : "composer";

  const fields = {
    body: validated.body,
    scheduled_at: scheduledAt,
    status: wantsSchedule ? "scheduled" : "draft",
    source,
    // A row being rescheduled after a failure starts its attempts over —
    // otherwise a post that failed twice on a broken connection can only
    // ever be retried once after the connection is fixed.
    attempts: 0,
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    // A posted row is history. Editing one would rewrite the record of
    // something that is already live on X.
    const { data: existing, error: existingError } = await supabase
      .from("scheduled_posts")
      .select("status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingError) {
      console.error("scheduler/save failed to load post", existingError);
      return NextResponse.json({ error: "Could not save that post." }, { status: 502 });
    }

    if (!existing) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    if (existing.status === "posted") {
      return NextResponse.json(
        { error: "That post has already gone out." },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("scheduled_posts")
      .update(fields)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("scheduler/save failed to update", error);
      return NextResponse.json({ error: "Could not save that post." }, { status: 502 });
    }

    return NextResponse.json({ post: data as ScheduledPostRow });
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({ ...fields, user_id: user.id })
    .select()
    .single();

  if (error) {
    console.error("scheduler/save failed to insert", error);
    return NextResponse.json({ error: "Could not save that post." }, { status: 502 });
  }

  return NextResponse.json({
    post: data as ScheduledPostRow,
    usage: await getPostUsage(supabase, user.id),
  });
}
