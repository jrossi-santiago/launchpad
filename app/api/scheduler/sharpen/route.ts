import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { buildMockSharpen, sharpenPost } from "@/lib/anthropic/sharpen";
import { validateBody } from "@/lib/scheduler/posts";

// Nothing is stored here. The suggestion comes back to the composer and
// the founder decides whether to take it — a sharpened post they never
// accepted is not a post, and writing it to the table would put it in
// the queue behind their back.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const validated = validateBody((payload as { body?: unknown } | null)?.body);

  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { data: brandPack, error: brandPackError } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (brandPackError) {
    console.error("scheduler/sharpen failed to load brand pack", brandPackError);
    return NextResponse.json({ error: "Could not sharpen that post." }, { status: 502 });
  }

  if (!brandPack) {
    return NextResponse.json(
      { error: "Fill in your Brand Pack first — it's what your voice is matched against." },
      { status: 400 },
    );
  }

  try {
    const result = process.env.ANTHROPIC_API_KEY
      ? await sharpenPost(brandPack as BrandPackRow, validated.body)
      : buildMockSharpen(validated.body);

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "scheduler/sharpen failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Could not sharpen that post. Try again." },
      { status: 502 },
    );
  }
}
