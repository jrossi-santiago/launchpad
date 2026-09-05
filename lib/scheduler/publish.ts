import type { createClient } from "@/lib/supabase/server";
import { XConnectionError, postAs, type XConnectionRow } from "@/lib/x/writer";
import { getPostUsage, type ScheduledPostRow } from "@/lib/scheduler/posts";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// How many times a row may be claimed before it is given up on. Matches
// the `attempts < 3` in claim_due_scheduled_posts() — the SQL stops
// handing the row out, and this is what writes the reason down.
export const MAX_ATTEMPTS = 3;

export type PublishOutcome =
  | { ok: true; postedTweetId: string }
  | { ok: false; error: string };

// Sends one post and writes down what happened. The single send path in
// the app: "Post now" and the 07:00 cron run both end up here, so there
// is one place where a post can go out and one place where the daily cap
// is enforced.
//
// `supabase` is the session client when a person pressed a button and
// the service client when the worker ran. The row already says whose
// post this is, so nothing below reads a session — which is what lets
// the same function serve both.
//
// A failure is classified before it is stored. `permanent` means trying
// again in five minutes cannot help — no X connection, a cookie-only
// connection, the daily cap — so the row goes to `failed` with the
// reason on it instead of being retried twice more and failing the same
// way. Everything else (a 500 from X, a network blip) goes back to
// `scheduled` and is picked up by the next run.
export async function publishPost(
  supabase: SupabaseServerClient,
  post: ScheduledPostRow,
): Promise<PublishOutcome> {
  const fail = async (error: string, permanent: boolean): Promise<PublishOutcome> => {
    const exhausted = permanent || post.attempts >= MAX_ATTEMPTS;

    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({
        status: exhausted ? "failed" : "scheduled",
        last_error: error,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);

    if (updateError) {
      console.error("scheduler/publish failed to record failure", updateError);
    }

    return { ok: false, error };
  };

  const { data: connection, error: connectionError } = await supabase
    .from("x_connections")
    .select("*")
    .eq("user_id", post.user_id)
    .maybeSingle();

  if (connectionError) {
    console.error("scheduler/publish failed to load connection", connectionError);
    return fail("Could not read your X connection.", false);
  }

  if (!connection || !connection.x_handle) {
    return fail("No X account is connected. Connect one in You → Settings.", true);
  }

  // Checked here rather than only at schedule time, because the check
  // that matters is the one at the moment of sending: five posts can be
  // lined up on Monday and all come due on Tuesday.
  const usage = await getPostUsage(supabase, post.user_id);
  if (usage.remaining <= 0) {
    return fail(
      `You'd already sent ${usage.limit} posts today, which is the daily limit. This one was not sent.`,
      true,
    );
  }

  try {
    // `null` is the whole difference between this and every other send
    // in the app: no tweet to reply to means a standalone post. See the
    // note on postAs() in lib/x/writer.ts — the cookie path refuses
    // this deliberately, and that arrives here as an XConnectionError.
    const result = await postAs(supabase, connection as XConnectionRow, post.body, null);

    const { error: updateError } = await supabase
      .from("scheduled_posts")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        posted_x_tweet_id: result.postedTweetId,
        last_error: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);

    if (updateError) throw updateError;

    return { ok: true, postedTweetId: result.postedTweetId };
  } catch (error) {
    console.error(
      "scheduler/publish failed to post",
      error instanceof Error ? error.message : error,
    );

    return fail(
      error instanceof Error ? error.message : "X refused the post.",
      error instanceof XConnectionError,
    );
  }
}
