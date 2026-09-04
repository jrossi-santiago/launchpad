import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_LEAD_IDS = 100;

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
  const leadIds = Array.isArray(record?.lead_ids) ? record.lead_ids : null;

  if (!leadIds || leadIds.length === 0 || !leadIds.every((id) => typeof id === "string")) {
    return NextResponse.json(
      { error: "Missing or invalid lead_ids." },
      { status: 400 },
    );
  }

  if (leadIds.length > MAX_LEAD_IDS) {
    return NextResponse.json(
      { error: `Delete at most ${MAX_LEAD_IDS} leads at a time.` },
      { status: 400 },
    );
  }

  const { data: deleted, error } = await supabase
    .from("leads")
    .delete()
    .eq("user_id", user.id)
    .in("id", leadIds)
    .select("id");

  if (error) {
    console.error("leads/delete failed", error);
    return NextResponse.json(
      { error: "Failed to delete those leads. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ deletedIds: (deleted ?? []).map((row) => row.id) });
}
