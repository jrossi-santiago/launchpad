import { createClient } from "@/lib/supabase/server";
import { loadBoard } from "@/lib/pipeline/board";
import {
  Room2Board,
  type RecentPost,
  type Room2Card,
} from "@/components/pipeline/Room2Board";
import { MAX_COMMENTS_WHILE_LIVE } from "@/lib/pipeline/rules";

// Room 2: the Commenter loop pointed at individual buyers instead of the
// Network feed. Five to ten people, three comments each, and the app
// counting so you don't have to.
export default async function Room2Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The (app) layout already redirects unauthenticated visitors to /login.
    return null;
  }

  const board = await loadBoard(supabase, user.id);
  const handles = board.live.map((card) => card.lead.handle);

  // A live lead who is also a watched account already has their posts in
  // Network, so reuse them rather than spending a poll. Everyone else
  // gets the paste-a-URL path.
  const { data: profiles } = handles.length
    ? await supabase
        .from("network_profiles")
        .select("id, handle")
        .eq("user_id", user.id)
        .in("handle", handles)
    : { data: [] as { id: string; handle: string }[] };

  const profileRows = (profiles ?? []) as { id: string; handle: string }[];
  const profileIdByHandle = new Map(
    profileRows.map((row) => [row.handle.toLowerCase(), row.id]),
  );

  const { data: tweets } = profileRows.length
    ? await supabase
        .from("network_tweets")
        .select("id, profile_id, content, url, posted_at")
        .eq("user_id", user.id)
        .in(
          "profile_id",
          profileRows.map((row) => row.id),
        )
        .order("posted_at", { ascending: false })
    : { data: [] as [] };

  type TweetRow = {
    id: string;
    profile_id: string;
    content: string | null;
    url: string | null;
    posted_at: string | null;
  };

  const postsByProfile = new Map<string, RecentPost[]>();
  for (const tweet of (tweets ?? []) as TweetRow[]) {
    const list = postsByProfile.get(tweet.profile_id) ?? [];
    // Their last three, which is enough to find something worth saying
    // without turning this into a second feed.
    if (list.length >= 3) continue;
    list.push({
      id: tweet.id,
      content: tweet.content,
      url: tweet.url,
      posted_at: tweet.posted_at,
    });
    postsByProfile.set(tweet.profile_id, list);
  }

  const cards: Room2Card[] = board.live.map((card) => {
    const profileId = profileIdByHandle.get(card.lead.handle.toLowerCase());
    return {
      ...card,
      recentPosts: profileId ? (postsByProfile.get(profileId) ?? []) : [],
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Room 2
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {board.liveCount} of {board.liveCap} live · up to{" "}
          {MAX_COMMENTS_WHILE_LIVE} comments each, two days apart. You post
          every comment yourself — this only keeps score.{" "}
          <a
            href="/you/pipeline"
            className="underline decoration-dotted underline-offset-2"
          >
            Manage the room
          </a>
        </p>
      </div>

      <Room2Board cards={cards} />
    </div>
  );
}
