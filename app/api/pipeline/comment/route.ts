import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLiveLike, type PipelineLeadRow } from "@/lib/pipeline/rules";

// "I posted that" — the same admission the Queue already asks for, with
// the lead it was on attached. Nothing here posts anything; it records
// that the user did.
//
// The pacing rules (3 comments, 2 days apart) are deliberately NOT
// enforced here. They decide what the chip suggests; a comment the user
// actually posted has to be recordable either way, or the counts stop
// matching reality and every suggestion built on them is wrong.
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
  const ourCommentUrl =
    typeof record?.our_comment_url === "string" && record.our_comment_url
      ? record.our_comment_url
      : null;
  const theirPostUrl =
    typeof record?.their_post_url === "string" && record.their_post_url
      ? record.their_post_url
      : null;

  if (!leadId) {
    return NextResponse.json({ error: "Missing lead_id." }, { status: 400 });
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
      { error: `@${lead.handle} isn't live. Move them into Room 2 first.` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  const { data: event, error: eventError } = await supabase
    .from("pipeline_comment_events")
    .insert({
      user_id: user.id,
      pipeline_lead_id: lead.id,
      our_comment_url: ourCommentUrl,
      their_post_url: theirPostUrl,
      at: now,
    })
    .select()
    .single();

  if (eventError) {
    console.error("pipeline/comment insert failed", eventError);
    return NextResponse.json(
      { error: "Couldn't log that comment. Please try again." },
      { status: 502 },
    );
  }

  const { data: updated, error: leadError } = await supabase
    .from("pipeline_leads")
    .update({
      our_comment_count: lead.our_comment_count + 1,
      last_our_comment_at: now,
      updated_at: now,
    })
    .eq("id", lead.id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (leadError) {
    console.error("pipeline/comment lead update failed", leadError);
    return NextResponse.json(
      { error: "Logged the comment but couldn't update the count." },
      { status: 502 },
    );
  }

  return NextResponse.json({ lead: updated, event });
}
