import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildMockBrandPack,
  callClaude,
  upsertBrandPack,
  type InterviewAnswers,
} from "@/lib/anthropic/brandPack";

function isInterviewAnswers(body: unknown): body is InterviewAnswers {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.what_you_sell === "string" &&
    typeof value.who_its_for === "string" &&
    typeof value.desired_next_action === "string" &&
    Array.isArray(value.example_posts) &&
    value.example_posts.every((post) => typeof post === "string") &&
    typeof value.never_say === "string"
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
  if (!isInterviewAnswers(body)) {
    return NextResponse.json(
      { error: "Invalid interview answers." },
      { status: 400 },
    );
  }

  try {
    const fields = process.env.ANTHROPIC_API_KEY
      ? await callClaude(body)
      : buildMockBrandPack(body);

    const pack = await upsertBrandPack(supabase, user.id, fields, body);
    return NextResponse.json(pack);
  } catch (error) {
    console.error("brand-pack/generate failed", error);
    return NextResponse.json(
      { error: "Failed to generate your Brand Pack. Please try again." },
      { status: 502 },
    );
  }
}
