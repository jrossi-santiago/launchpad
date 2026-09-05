import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPostUsage, type ScheduledPostRow } from "@/lib/scheduler/posts";
import { SchedulerTab } from "@/components/scheduler/SchedulerTab";

// The queue is read here rather than fetched by the client, the same way
// the Commenter queue is: the first paint should already show what is
// lined up, because "what is going out today" is the question this tab
// exists to answer.
export default async function SchedulerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The (app) layout already redirects unauthenticated visitors.
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

  const [{ data: posts }, usage, { data: connection }] = await Promise.all([
    supabase
      .from("scheduled_posts")
      .select("*")
      .eq("user_id", user.id)
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(50),
    getPostUsage(supabase, user.id),
    supabase
      .from("x_connections")
      .select("x_handle, auth_provider")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return (
    <SchedulerTab
      initialPosts={(posts ?? []) as ScheduledPostRow[]}
      initialUsage={usage}
      // Standalone posting only works through an officially connected
      // account — lib/x/writer.ts refuses it on the legacy cookie path.
      // Surfaced before anything is written rather than as a failure at
      // 07:00.
      canPost={connection?.auth_provider === "oauth2"}
      handle={connection?.x_handle ?? null}
    />
  );
}
