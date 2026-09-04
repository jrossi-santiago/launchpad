import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client, for the one code path that has no user session to
// act on behalf of: the inbound GetXAPI monitor webhook. It bypasses RLS,
// so it is only ever created inside a route that has already verified the
// delivery's HMAC signature, and every query it runs is scoped to a
// user_id explicitly.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the monitor webhook.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
