import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { publishPost } from "@/lib/scheduler/publish";
import type { ScheduledPostRow } from "@/lib/scheduler/posts";

// The worker. Vercel Cron hits this on a schedule (see vercel.json) and
// it sends whatever is due.
//
// GET because that is what Vercel Cron issues. It is not a read — it
// sends posts — which is the one place this app breaks the usual rule,
// and the reason the secret below is not optional.
//
// `export const dynamic` is deliberately absent: it is no longer in
// Next 16's route segment config table. Reading a header is what keeps
// this handler from being treated as static, and it does that on the
// first line.
export const maxDuration = 60;

// How many posts one run will send. Ten is well inside the 60s budget
// above (each is one X call), and anything left over is picked up by the
// next tick five minutes later rather than by a run that times out
// halfway through and leaves rows claimed.
const BATCH_SIZE = 10;

// Constant-time compare, so a wrong secret cannot be found a character
// at a time by timing the responses.
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return diff === 0;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;

  // No secret configured means anyone who finds this URL can trigger
  // sends. Refused rather than defaulted to open — this is the one route
  // in the app with no session behind it.
  if (!expected) {
    console.error("scheduler/run called with no CRON_SECRET set");
    return NextResponse.json({ error: "Scheduler is not configured." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Claim and mark in one statement, so two overlapping runs cannot take
  // the same row. See claim_due_scheduled_posts() in migration 0022 —
  // the `for update skip locked` inside it is what makes a double post
  // impossible, and X has no idempotency key to fall back on.
  const { data, error } = await supabase.rpc("claim_due_scheduled_posts", {
    batch_size: BATCH_SIZE,
  });

  if (error) {
    console.error("scheduler/run failed to claim posts", error);
    return NextResponse.json({ error: "Could not claim due posts." }, { status: 502 });
  }

  const due = (data ?? []) as ScheduledPostRow[];

  // Sequentially, not in parallel. These are writes to X from several
  // different accounts and there is no hurry — ten posts spread over a
  // few seconds is a friendlier shape than ten simultaneous writes, and
  // one slow send cannot then drag nine others into the timeout.
  const results = [];
  for (const post of due) {
    const outcome = await publishPost(supabase, post);
    results.push({ id: post.id, ...outcome });
  }

  const sent = results.filter((result) => result.ok).length;

  return NextResponse.json({
    claimed: due.length,
    sent,
    failed: results.length - sent,
  });
}
