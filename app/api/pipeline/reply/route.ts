import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  canTransition,
  isLiveLike,
  type PipelineLeadRow,
  type PipelineStatus,
} from "@/lib/pipeline/rules";

// Inbound, entered by hand. Two shapes:
//
//   signal "like"   they liked one of our comments -> seen_you
//   signal "reply"  they replied to us             -> seen_you, or
//                   conversation once there are two, or immediately when
//                   the user says it had substance
//
// No DMs are read and no timeline is scraped for this: the user saw the
// notification, so the user marks it.
function isSignal(value: unknown): value is "like" | "reply" {
  return value === "like" || value === "reply";
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
  const leadId = typeof record?.lead_id === "string" ? record.lead_id : null;
  const signal = isSignal(record?.signal) ? record.signal : null;
  const eventId = typeof record?.event_id === "string" ? record.event_id : null;
  const replyUrl =
    typeof record?.their_reply_url === "string" && record.their_reply_url
      ? record.their_reply_url
      : null;
  const substantive = record?.substantive === true;

  if (!leadId || !signal) {
    return NextResponse.json(
      { error: "Missing or invalid lead_id/signal." },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from("pipeline_leads")
    .select("*")
    .eq("id", leadId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const lead = existing as PipelineLeadRow;

  if (!isLiveLike(lead.status)) {
    return NextResponse.json(
      { error: `@${lead.handle} isn't live, so there's nothing to reply to yet.` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    last_signal_at: now,
    updated_at: now,
    // Any sign of life resets the "they're ignoring you" clock, so a
    // suggestion raised yesterday stops nagging today.
    keep_until: null,
  };

  if (signal === "reply") {
    // Marking the specific comment they replied to is optional — the
    // count is what the rules read, the event is what the log shows.
    if (eventId) {
      const { error: eventError } = await supabase
        .from("pipeline_comment_events")
        .update({ they_replied: true, their_reply_url: replyUrl })
        .eq("id", eventId)
        .eq("user_id", user.id)
        .eq("pipeline_lead_id", lead.id);

      if (eventError) {
        console.error("pipeline/reply event update failed", eventError);
      }
    }

    const replyCount = lead.their_reply_count + 1;
    update.their_reply_count = replyCount;
    update.their_last_reply_at = now;

    // Two replies, or one the user calls substantive, is a conversation.
    const target: PipelineStatus =
      substantive || replyCount >= 2 ? "conversation" : "seen_you";

    // Never downgrade: someone already in conversation or pitched stays
    // there when another reply lands.
    if (canTransition(lead.status, target)) update.status = target;
  } else if (canTransition(lead.status, "seen_you")) {
    update.status = "seen_you";
  }

  const { data: updated, error } = await supabase
    .from("pipeline_leads")
    .update(update)
    .eq("id", lead.id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("pipeline/reply update failed", error);
    return NextResponse.json(
      { error: "Couldn't record that. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ lead: updated });
}
