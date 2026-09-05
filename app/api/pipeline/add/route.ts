import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseHandle } from "@/lib/getx/userTweets";
import { isIcp, WAITLIST_CAP, type Icp } from "@/lib/pipeline/rules";

type LeadSource = {
  id: string;
  x_username: string;
  name: string | null;
  bio: string | null;
  source: string | null;
  tweet_id: string | null;
};

// "replied" | "retweeted" is what the Leads pull writes; the pipeline
// talks about replies and reposts.
function sourceTypeFrom(source: string | null): string | null {
  if (source === "replied") return "reply";
  if (source === "retweeted") return "repost";
  return null;
}

function snippet(bio: string | null): string | null {
  if (!bio) return null;
  const flat = bio.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 177)}…` : flat;
}

// Two ways in: promote rows out of the existing Leads table (the warm
// pull off a Room 1 post), or type a handle. Both land on the waitlist —
// nothing goes straight to live, because the live cap is what makes the
// room small enough to work.
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
  const rawHandle = typeof record?.handle === "string" ? record.handle : "";
  const icp: Icp = isIcp(record?.icp) ? record.icp : "unrated";
  const sourcePostUrl =
    typeof record?.source_post_url === "string" && record.source_post_url
      ? record.source_post_url
      : null;

  if (leadIds.length === 0 && !rawHandle) {
    return NextResponse.json(
      { error: "Pick at least one lead, or type a handle." },
      { status: 400 },
    );
  }

  const { count: waitlistCount } = await supabase
    .from("pipeline_leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "waitlist");

  const room = WAITLIST_CAP - (waitlistCount ?? 0);
  if (room <= 0) {
    return NextResponse.json(
      {
        error: `Your waitlist is full at ${WAITLIST_CAP}. Move someone live or skip a few first.`,
      },
      { status: 400 },
    );
  }

  type Insert = {
    user_id: string;
    handle: string;
    display_name: string | null;
    bio_snippet: string | null;
    icp: Icp;
    source_post_url: string | null;
    source_type: string | null;
    lead_id: string | null;
    status: "waitlist";
  };

  const inserts: Insert[] = [];

  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, x_username, name, bio, source, tweet_id")
      .eq("user_id", user.id)
      .in("id", leadIds);

    if (leadsError) {
      console.error("pipeline/add failed to read leads", leadsError);
      return NextResponse.json(
        { error: "Couldn't read those leads. Please try again." },
        { status: 502 },
      );
    }

    for (const lead of (leads ?? []) as LeadSource[]) {
      const handle = parseHandle(lead.x_username);
      if (!handle) continue;
      inserts.push({
        user_id: user.id,
        handle,
        display_name: lead.name,
        bio_snippet: snippet(lead.bio),
        icp,
        source_post_url: sourcePostUrl,
        source_type: sourceTypeFrom(lead.source),
        lead_id: lead.id,
        status: "waitlist",
      });
    }
  }

  if (rawHandle) {
    const handle = parseHandle(rawHandle);
    if (!handle) {
      return NextResponse.json(
        { error: "That doesn't look like an X handle or profile URL." },
        { status: 400 },
      );
    }
    inserts.push({
      user_id: user.id,
      handle,
      display_name: null,
      bio_snippet: null,
      icp,
      source_post_url: sourcePostUrl,
      source_type: null,
      lead_id: null,
      status: "waitlist",
    });
  }

  if (inserts.length === 0) {
    return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
  }

  const overflow = inserts.length - room;
  const accepted = overflow > 0 ? inserts.slice(0, room) : inserts;

  // ignoreDuplicates so a second pull of the same audience is a no-op for
  // the people already in the pipeline rather than resetting their status
  // back to waitlist — a lead you are live on must not be dragged back by
  // showing up on another Room 1 post.
  const { data: inserted, error } = await supabase
    .from("pipeline_leads")
    .upsert(accepted, {
      onConflict: "user_id,handle",
      ignoreDuplicates: true,
    })
    .select();

  if (error) {
    console.error("pipeline/add insert failed", error);
    return NextResponse.json(
      { error: "Couldn't add to the waitlist. Please try again." },
      { status: 502 },
    );
  }

  const added = (inserted ?? []).length;
  const skipped = accepted.length - added;

  return NextResponse.json({
    added,
    already_in_pipeline: skipped,
    over_cap: overflow > 0 ? overflow : 0,
  });
}
