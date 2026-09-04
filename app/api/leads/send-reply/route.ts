import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { XConnectionError, postAs, type XConnectionRow } from "@/lib/x/writer";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const leadId =
    body && typeof body === "object" && typeof (body as { lead_id?: unknown }).lead_id === "string"
      ? (body as { lead_id: string }).lead_id
      : null;

  if (!leadId) {
    return NextResponse.json({ error: "Missing lead_id." }, { status: 400 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (leadError) {
    console.error("leads/send-reply failed to load lead", leadError);
    return NextResponse.json(
      { error: "Failed to send that reply. Please try again." },
      { status: 502 },
    );
  }

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  if (!lead.reply_tweet_id) {
    return NextResponse.json(
      { error: "This lead has no reply tweet to reply into." },
      { status: 400 },
    );
  }

  if (!lead.outreach_draft) {
    return NextResponse.json(
      { error: "Generate an outreach draft for this lead first." },
      { status: 400 },
    );
  }

  const { data: connection, error: connectionError } = await supabase
    .from("x_connections")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connectionError) {
    console.error("leads/send-reply failed to load connection", connectionError);
    return NextResponse.json(
      { error: "Failed to send that reply. Please try again." },
      { status: 502 },
    );
  }

  if (!connection || !connection.x_handle) {
    return NextResponse.json(
      { error: "Connect your X account in Settings first." },
      { status: 400 },
    );
  }

  const userId = user.id;

  async function recordFailedAction() {
    const { error } = await supabase.from("actions").insert({
      user_id: userId,
      action_type: "reply",
      target_tweet_id: null,
      target_username: lead.x_username,
      status: "failed",
    });
    if (error) console.error("leads/send-reply failed to record failed action", error);
  }

  try {
    const result = await postAs(
      supabase,
      connection as XConnectionRow,
      lead.outreach_draft,
      lead.reply_tweet_id,
    );

    const { error: actionError } = await supabase.from("actions").insert({
      user_id: user.id,
      action_type: "reply",
      target_tweet_id: null,
      target_username: lead.x_username,
      status: "success",
    });

    if (actionError) throw actionError;

    const { data: updated, error: updateError } = await supabase
      .from("leads")
      .update({ status: "replied" })
      .eq("id", lead.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      lead: updated,
      permalink: `https://x.com/i/status/${result.postedTweetId}`,
    });
  } catch (error) {
    console.error(
      "leads/send-reply failed",
      error instanceof Error ? error.message : error,
    );
    await recordFailedAction();
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send that reply. Please try again.",
      },
      { status: error instanceof XConnectionError ? 400 : 502 },
    );
  }
}
