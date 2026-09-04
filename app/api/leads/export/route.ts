import { createClient } from "@/lib/supabase/server";

const SOURCE_LABELS: Record<string, string> = {
  replied: "replied",
  retweeted: "retweeted",
};

// Quotes a CSV field only when it contains a comma, quote, or newline —
// doubling any embedded quotes, per RFC 4180.
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (leadsError) {
    console.error("leads/export failed to load leads", leadsError);
    return new Response("Failed to export leads.", { status: 502 });
  }

  const leadRows = leads ?? [];
  const tweetIds = Array.from(
    new Set(
      leadRows
        .map((lead) => lead.tweet_id)
        .filter((id): id is string => id != null),
    ),
  );

  const { data: tweets } =
    tweetIds.length > 0
      ? await supabase.from("tweets").select("id, url").in("id", tweetIds)
      : { data: [] };

  const urlByTweetId = new Map<string, string>();
  for (const tweet of tweets ?? []) {
    urlByTweetId.set(tweet.id as string, (tweet.url as string | null) ?? "");
  }

  const header = ["handle", "bio", "followers", "source url", "type", "status", "draft"];
  const lines = [header.join(",")];

  for (const lead of leadRows) {
    const row = [
      lead.x_username ?? "",
      lead.bio ?? "",
      lead.followers_count != null ? String(lead.followers_count) : "",
      lead.tweet_id ? urlByTweetId.get(lead.tweet_id) ?? "" : "",
      SOURCE_LABELS[lead.source ?? ""] ?? lead.source ?? "",
      lead.status ?? "",
      lead.outreach_draft ?? "",
    ];
    lines.push(row.map((field) => csvField(field)).join(","));
  }

  const csv = lines.join("\r\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="launchpad-leads.csv"',
    },
  });
}
