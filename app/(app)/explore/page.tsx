import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildExploreQueries } from "@/lib/getx/search";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { ExploreTab } from "@/components/explore/ExploreTab";

export default async function ExplorePage() {
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
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!brandPack) {
    redirect("/home");
  }

  const pack = brandPack as BrandPackRow;

  return (
    <ExploreTab
      chips={buildExploreQueries(pack)}
      templates={pack.reply_templates ?? []}
    />
  );
}
