import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { buildDefaultNiche } from "@/lib/getx/heatcheck";
import { getHeatCheckUsage } from "@/lib/usage/heatChecks";
import { HeatCheckTab } from "@/components/heatcheck/HeatCheckTab";

// Nothing is fetched or read here — the page renders the button and the
// niche line, and the run only ever happens on a press.
export default async function HeatCheckPage() {
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
    redirect("/you/brand-pack");
  }

  const usage = await getHeatCheckUsage(supabase, user.id);

  return (
    <HeatCheckTab
      defaultNiche={buildDefaultNiche(brandPack as BrandPackRow)}
      initialUsage={usage}
    />
  );
}
