import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { buildMockOutreachDraft, generateOutreachDraft } from "@/lib/anthropic/outreach";

const MAX_LEAD_IDS = 25;

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
      { error: `Generate at most ${MAX_LEAD_IDS} leads at a time.` },
      { status: 400 },
    );
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    return NextResponse.json(
      { error: "Create a Brand Pack first." },
      { status: 400 },
    );
  }

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", user.id)
    .in("id", leadIds);

  if (leadsError) {
    console.error("leads/generate-drafts failed to load leads", leadsError);
    return NextResponse.json(
      { error: "Failed to generate drafts. Please try again." },
      { status: 502 },
    );
  }

  const eligibleLeads = (leads ?? []).filter(
    (lead) => lead.status === "new" || lead.status === "drafted",
  );

  if (eligibleLeads.length === 0) {
    return NextResponse.json({ leads: [] });
  }

  const tweetIds = Array.from(
    new Set(
      eligibleLeads
        .map((lead) => lead.tweet_id)
        .filter((id): id is string => id != null),
    ),
  );

  const { data: tweets, error: tweetsError } =
    tweetIds.length > 0
      ? await supabase.from("tweets").select("id, content").in("id", tweetIds)
      : { data: [], error: null };

  if (tweetsError) {
    console.error("leads/generate-drafts failed to load source tweets", tweetsError);
    return NextResponse.json(
      { error: "Failed to generate drafts. Please try again." },
      { status: 502 },
    );
  }

  const contentByTweetId = new Map<string, string>();
  for (const tweet of tweets ?? []) {
    contentByTweetId.set(tweet.id as string, (tweet.content as string | null) ?? "");
  }

  const updatedLeads = [];

  try {
    for (const lead of eligibleLeads) {
      const snippet = (lead.tweet_id ? contentByTweetId.get(lead.tweet_id) : "") ?? "";
      const input = {
        brandPack: brandPack as BrandPackRow,
        lead: { x_username: lead.x_username, name: lead.name, bio: lead.bio },
        sourceSnippet: snippet.slice(0, 200),
        source: (lead.source ?? "replied") as "replied" | "retweeted",
      };

      const draft = process.env.ANTHROPIC_API_KEY
        ? await generateOutreachDraft(input)
        : buildMockOutreachDraft(input);

      const { data: updated, error: updateError } = await supabase
        .from("leads")
        .update({ outreach_draft: draft, status: "drafted" })
        .eq("id", lead.id)
        .select()
        .single();

      if (updateError) throw updateError;
      updatedLeads.push(updated);
    }
  } catch (error) {
    console.error(
      "leads/generate-drafts failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to generate drafts. Please try again.", leads: updatedLeads },
      { status: 502 },
    );
  }

  return NextResponse.json({ leads: updatedLeads });
}
