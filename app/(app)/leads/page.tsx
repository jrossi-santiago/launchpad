import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeadsTable, type LeadRow } from "@/components/leads/LeadsTable";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const leadRows = (leads ?? []) as LeadRow[];

  const tweetIds = Array.from(
    new Set(leadRows.map((lead) => lead.tweet_id).filter((id): id is string => id != null)),
  );

  const { data: tweets } =
    tweetIds.length > 0
      ? await supabase
          .from("tweets")
          .select("id, author_handle, content")
          .in("id", tweetIds)
      : { data: [] };

  const sourceTweets = (tweets ?? []).map((tweet) => ({
    id: tweet.id as string,
    label: `${tweet.author_handle ?? "Unknown"}: "${(tweet.content ?? "").slice(0, 60)}${
      (tweet.content ?? "").length > 60 ? "…" : ""
    }"`,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Leads
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Repliers and retweeters pulled in from your Launchpad queue.
        </p>
      </div>

      <LeadsTable initialLeads={leadRows} sourceTweets={sourceTweets} />
    </div>
  );
}
