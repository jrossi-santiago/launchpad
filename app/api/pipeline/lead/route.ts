import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isIcp } from "@/lib/pipeline/rules";

// The two fields that are neither status nor a logged event: the ICP
// rating you give someone when you add them, and the note you keep on
// them. Both are free to change at any point in the pipeline.
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

  if (!leadId) {
    return NextResponse.json({ error: "Missing lead_id." }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("icp" in (record ?? {})) {
    if (!isIcp(record?.icp)) {
      return NextResponse.json({ error: "icp must be yes, no or unrated." }, { status: 400 });
    }
    update.icp = record.icp;
  }

  if ("notes" in (record ?? {})) {
    const notes = record?.notes;
    if (notes !== null && typeof notes !== "string") {
      return NextResponse.json({ error: "notes must be text." }, { status: 400 });
    }
    update.notes = notes;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("pipeline_leads")
    .update(update)
    .eq("id", leadId)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("pipeline/lead update failed", error);
    return NextResponse.json(
      { error: "Couldn't save that. Please try again." },
      { status: 502 },
    );
  }

  if (!updated) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({ lead: updated });
}
