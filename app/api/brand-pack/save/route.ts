import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertBrandPack, type BrandPackFields } from "@/lib/anthropic/brandPack";

function isBrandPackFields(body: unknown): body is BrandPackFields {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.positioning === "string" &&
    Array.isArray(value.icp_bullets) &&
    value.icp_bullets.every((bullet) => typeof bullet === "string") &&
    typeof value.voice_notes === "string" &&
    Array.isArray(value.reply_templates) &&
    value.reply_templates.every((template) => typeof template === "string")
  );
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
  if (!isBrandPackFields(body)) {
    return NextResponse.json(
      { error: "Invalid Brand Pack fields." },
      { status: 400 },
    );
  }

  try {
    const pack = await upsertBrandPack(supabase, user.id, body);
    return NextResponse.json(pack);
  } catch (error) {
    console.error("brand-pack/save failed", error);
    return NextResponse.json(
      { error: "Failed to save your Brand Pack. Please try again." },
      { status: 500 },
    );
  }
}
