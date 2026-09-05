import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LaunchpadQueue, type QueueItem } from "@/components/launchpad/LaunchpadQueue";
import type { PostableDraft } from "@/components/launchpad/TweetCard";
import type { TweetRow } from "@/lib/getx/tweet";
import { getRegenerationUsage } from "@/lib/usage/regenerations";
import { getAllActionUsage } from "@/lib/usage/actions";
import { canAutoReply, type XConnectionRow } from "@/lib/x/writer";

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
    redirect("/you/brand-pack");
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
    : { data: [] as PostableDraft[] };

  const draftsByTweetId = new Map<string, PostableDraft[]>();
  for (const draft of (drafts ?? []) as PostableDraft[]) {
    const list = draftsByTweetId.get(draft.tweet_id) ?? [];
    list.push(draft);
    draftsByTweetId.set(draft.tweet_id, list);
  }

  const { data: successfulActions } = await supabase
    .from("actions")
    .select("action_type, target_tweet_id, target_username")
    .eq("user_id", user.id)
    .eq("status", "success")
    .in("action_type", ["like", "follow"]);

  const likedTweetIds = new Set<string>();
  const followedUsernames = new Set<string>();
  for (const action of successfulActions ?? []) {
    if (action.action_type === "like" && action.target_tweet_id) {
      likedTweetIds.add(action.target_tweet_id);
    }
    if (action.action_type === "follow" && action.target_username) {
      followedUsernames.add(action.target_username);
    }
  }

  const initialItems: QueueItem[] = tweetRows.map((tweet) => ({
    tweet,
    drafts: draftsByTweetId.get(tweet.id) ?? [],
    alreadyLiked: likedTweetIds.has(tweet.id),
    alreadyFollowedAuthor: tweet.author_handle
      ? followedUsernames.has(tweet.author_handle)
      : false,
  }));

  const initialUsage = await getRegenerationUsage(supabase, user.id);
  const initialActionUsage = await getAllActionUsage(supabase, user.id, user.email);

  const { data: xConnection } = await supabase
    .from("x_connections")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <LaunchpadQueue
      initialItems={initialItems}
      initialUsage={initialUsage}
      xHandle={xConnection?.x_handle ?? null}
      canAutoReply={
        xConnection ? canAutoReply(xConnection as XConnectionRow) : false
      }
      initialActionUsage={initialActionUsage}
    />
  );
}
