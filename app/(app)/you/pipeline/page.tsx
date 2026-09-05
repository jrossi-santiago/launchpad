import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadBoard } from "@/lib/pipeline/board";
import {
  PipelineBoard,
  type WaitlistCandidate,
} from "@/components/pipeline/PipelineBoard";

// Who is in the room, and who is next. The commenting itself happens in
// Commenter → Room 2; this page is the ledger behind it.
export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const board = await loadBoard(supabase, user.id);

  // Everyone already in the pipeline, in any status — including skipped,
  // so someone you turned down doesn't come back up the list on the next
  // audience pull.
  const { data: existing } = await supabase
    .from("pipeline_leads")
    .select("handle")
    .eq("user_id", user.id);

  const taken = new Set(
    ((existing ?? []) as { handle: string }[]).map((row) =>
      row.handle.toLowerCase(),
    ),
  );

  const { data: leads } = await supabase
    .from("leads")
    .select("id, x_username, name, bio, source, tweet_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  type LeadRow = {
    id: string;
    x_username: string;
    name: string | null;
    bio: string | null;
    source: string | null;
    tweet_id: string | null;
  };

  const leadRows = ((leads ?? []) as LeadRow[]).filter(
    (lead) => !taken.has(lead.x_username.toLowerCase()),
  );

  // The Room 1 post each candidate came from, so the waitlist row can
  // link back to what they replied to.
  const tweetIds = Array.from(
    new Set(leadRows.map((lead) => lead.tweet_id).filter((id): id is string => id != null)),
  );

  const { data: tweets } = tweetIds.length
    ? await supabase.from("tweets").select("id, url").in("id", tweetIds)
    : { data: [] as { id: string; url: string | null }[] };

  const urlByTweetId = new Map(
    ((tweets ?? []) as { id: string; url: string | null }[]).map((tweet) => [
      tweet.id,
      tweet.url,
    ]),
  );

  const candidates: WaitlistCandidate[] = leadRows.map((lead) => ({
    id: lead.id,
    x_username: lead.x_username,
    name: lead.name,
    bio: lead.bio,
    source: lead.source,
    source_post_url: lead.tweet_id ? (urlByTweetId.get(lead.tweet_id) ?? null) : null,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Pipeline
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Buyers pulled off your own posts: parked on the waitlist, worked a
          few at a time in Room 2, dropped to the backlog when they go cold.
        </p>
      </div>

      <PipelineBoard board={board} candidates={candidates} />
    </div>
  );
}
