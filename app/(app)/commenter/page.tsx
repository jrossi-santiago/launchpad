import { createClient } from "@/lib/supabase/server";
import { flattenStacks, loadStacks } from "@/lib/network/stack";
import { FeedStream } from "@/components/feed/FeedStream";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";

// Same unwrapping as the Network page: Supabase surfaces Postgres and
// PostgREST failures as a plain object with message/code/hint rather than
// an Error.
function describeError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error.";

  const e = error as { message?: unknown; code?: unknown; hint?: unknown };
  const message =
    typeof e.message === "string" && e.message ? e.message : "unknown error";
  const code = typeof e.code === "string" && e.code ? ` [${e.code}]` : "";
  const hint = typeof e.hint === "string" && e.hint ? ` ${e.hint}` : "";

  return `${message}${code}.${hint}`;
}

// The same cards as Network, in one stream instead of one column per
// account. Network keeps its board — this is the shape that fits a phone,
// not a replacement for triaging one person at a time.
export default async function FeedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The (app) layout already redirects unauthenticated visitors to /login.
    return null;
  }

  const result = await loadStacks(supabase, user.id).then(
    (stacks) => ({ stacks, error: null as unknown }),
    (error: unknown) => ({ stacks: [], error }),
  );

  if (result.error) console.error("feed page load failed", result.error);

  const [{ data: brandPack }, { data: connection }] = await Promise.all([
    supabase
      .from("brand_packs")
      .select("reply_templates")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("x_connections")
      .select("x_handle")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const templates = ((brandPack as Pick<BrandPackRow, "reply_templates"> | null)
    ?.reply_templates ?? []) as string[];

  return (
    <FeedStream
      initialFeed={flattenStacks(result.stacks)}
      hasProfiles={result.stacks.length > 0}
      templates={templates}
      xConnected={Boolean(connection?.x_handle)}
      initialError={
        result.error
          ? `Couldn't load your Feed — ${describeError(result.error)}`
          : null
      }
    />
  );
}
