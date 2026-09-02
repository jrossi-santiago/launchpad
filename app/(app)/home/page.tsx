import { createClient } from "@/lib/supabase/server";
import { BrandPackHome } from "@/components/brand-pack/BrandPackHome";
import type { BrandPackRow } from "@/lib/anthropic/brandPack";

export default async function HomePage() {
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

  return <BrandPackHome initialBrandPack={brandPack as BrandPackRow | null} />;
}
