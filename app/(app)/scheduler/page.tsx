import { ComingNext } from "@/components/ComingNext";

// The tab exists ahead of the feature on purpose: the nav shape is settled
// (Scheduler, HeatCheck, Commenter, You), and the post creator lands here
// without moving anything else. `postAs(..., replyToTweetId = null)` in
// lib/x/writer.ts already posts a standalone post, so what is missing is a
// queue table and a worker, not provider code.
export default function SchedulerPage() {
  return (
    <ComingNext
      title="Scheduler"
      description="Write posts with AI help and line them up. Comments get you seen; your own posts are where the attention lands."
    />
  );
}
