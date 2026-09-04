import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isStatus(value: unknown): value is "replied" | "skipped" {
  return value === "replied" || value === "skipped";
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
  const status = isStatus(record?.status) ? record.status : null;

  if (!leadId || !status) {
    return NextResponse.json(
      { error: "Missing or invalid lead_id/status." },
      { status: 400 },
    );
  }

  const { data: updated, error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", leadId)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("leads/status failed to update lead", error);
    return NextResponse.json(
      { error: "Failed to update that lead. Please try again." },
      { status: 502 },
    );
  }

  if (!updated) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({ lead: updated });
}
