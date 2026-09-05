import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { countLive, loadLiveCap } from "@/lib/pipeline/board";
import {
  canPromote,
  canTransition,
  isPipelineStatus,
  KEEP_DAYS,
  DAY_MS,
  type PipelineLeadRow,
  type PipelineStatus,
} from "@/lib/pipeline/rules";

// Every status change goes through here, including the two compound ones:
//
//   replace  stale -> backlog in a single press, freeing a live slot
//   keep     not a status at all, a 7-day snooze on the suggestion
//
// The transition table is checked server-side rather than trusted from
// the button that was clicked, so a tab left open overnight cannot walk a
// lead backwards into a state the rules never allow.
type Action = PipelineStatus | "replace" | "keep";

function isAction(value: unknown): value is Action {
  return isPipelineStatus(value) || value === "replace" || value === "keep";
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
  const action = isAction(record?.action) ? record.action : null;

  if (!leadId || !action) {
    return NextResponse.json(
      { error: "Missing or invalid lead_id/action." },
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
  const now = new Date();
  const update: Record<string, unknown> = { updated_at: now.toISOString() };

  if (action === "keep") {
    // Keep 7 days: the lead stays exactly where it is and stops being
    // suggested for a week.
    update.keep_until = new Date(now.getTime() + KEEP_DAYS * DAY_MS).toISOString();
  } else {
    // Replace is stale-then-backlog. The intermediate hop is checked so
    // the same rules apply as if the user had pressed both buttons.
    const path: PipelineStatus[] =
      action === "replace" ? ["stale", "backlog"] : [action];

    let from = lead.status;
    for (const to of path) {
      if (!canTransition(from, to)) {
        return NextResponse.json(
          {
            error: `Can't move ${lead.handle} from ${from} to ${to}.`,
          },
          { status: 400 },
        );
      }
      from = to;
    }

    const finalStatus = path[path.length - 1];

    // The one hard cap in the whole feature.
    if (finalStatus === "live") {
      const [liveCount, cap] = await Promise.all([
        countLive(supabase, user.id),
        loadLiveCap(supabase, user.id),
      ]);
      const check = canPromote(liveCount, cap);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }

      // A fresh run: the comment budget is per stint in the room, and the
      // append-only event log keeps the history either way.
      update.moved_to_live_at = now.toISOString();
      update.our_comment_count = 0;
      update.keep_until = null;
    }

    if (finalStatus === "pitched") update.pitched_at = now.toISOString();

    // Out of the room: the clock stops and the snooze is meaningless.
    if (finalStatus === "backlog" || finalStatus === "skipped" || finalStatus === "waitlist") {
      update.moved_to_live_at = null;
      update.keep_until = null;
    }

    update.status = finalStatus;
  }

  const { data: updated, error } = await supabase
    .from("pipeline_leads")
    .update(update)
    .eq("id", leadId)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("pipeline/status update failed", error);
    return NextResponse.json(
      { error: "Couldn't update that lead. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ lead: updated });
}
