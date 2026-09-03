import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildDefaultRadarQuery } from "@/lib/getx/search";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";
import { RadarSearch } from "@/components/radar/RadarSearch";

export default async function RadarPage() {
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

  const initialQuery = buildDefaultRadarQuery(brandPack as BrandPackRow);

  return (
    <RadarSearch
      initialQuery={initialQuery}
      initialMinFaves={20}
      initialRangeHours={72}
    />
  );
}
