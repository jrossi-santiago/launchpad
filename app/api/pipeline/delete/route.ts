import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Remove someone from the pipeline entirely. Distinct from "skip
// forever", which keeps the row so a later Room 1 pull knows not to
// re-offer them; this is for rows added by mistake.
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
  const leadIds = Array.isArray(record?.lead_ids)
    ? record.lead_ids.filter((id): id is string => typeof id === "string")
    : [];

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "Missing lead_ids." }, { status: 400 });
  }

  const { error } = await supabase
    .from("pipeline_leads")
    .delete()
    .eq("user_id", user.id)
    .in("id", leadIds);

  if (error) {
    console.error("pipeline/delete failed", error);
    return NextResponse.json(
      { error: "Couldn't remove those. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ removed: leadIds.length });
}
