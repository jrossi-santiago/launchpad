import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LaunchpadQueue, type QueueItem } from "@/components/launchpad/LaunchpadQueue";
import type { TweetRow } from "@/lib/getx/tweet";
import type { DraftRow } from "@/lib/anthropic/drafts";
import { getRegenerationUsage } from "@/lib/usage/regenerations";

export default async function LaunchpadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The (app) layout already redirects unauthenticated visitors to /login.
    return null;
  }

  const { data: brandPack } = await supabase
    .from("brand_packs")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    redirect("/home");
  }

  const { data: tweets } = await supabase
    .from("tweets")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const tweetRows = (tweets ?? []) as TweetRow[];
  const tweetIds = tweetRows.map((tweet) => tweet.id);

  const { data: drafts } = tweetIds.length
    ? await supabase
        .from("drafts")
        .select("*")
        .in("tweet_id", tweetIds)
        .order("variant", { ascending: true })
    : { data: [] as DraftRow[] };

  const draftsByTweetId = new Map<string, DraftRow[]>();
  for (const draft of (drafts ?? []) as DraftRow[]) {
    const list = draftsByTweetId.get(draft.tweet_id) ?? [];
    list.push(draft);
    draftsByTweetId.set(draft.tweet_id, list);
  }

  const initialItems: QueueItem[] = tweetRows.map((tweet) => ({
    tweet,
    drafts: draftsByTweetId.get(tweet.id) ?? [],
  }));

  const initialUsage = await getRegenerationUsage(supabase, user.id);

  return <LaunchpadQueue initialItems={initialItems} initialUsage={initialUsage} />;
}
