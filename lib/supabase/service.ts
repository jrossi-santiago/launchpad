import { createServerClient } from "@supabase/ssr";

// The one Supabase client in this app that is not a signed-in person.
//
// Every other query runs as the user whose cookie is on the request, and
// RLS ("owner full access") is what keeps one founder out of another's
// rows. The scheduler worker has no cookie — it is a cron hit at 07:00,
// acting for someone who is asleep — so it holds the service role key
// and RLS does not apply to it at all.
//
// That is the whole risk of this file: a missing `.eq("user_id", …)` in
// worker code is not an empty result any more, it is every user's rows.
// Nothing here should ever be imported into a route that has a session;
// those use lib/supabase/server.ts.
//
// Built on createServerClient with no-op cookies rather than
// supabase-js's createClient so the returned type is identical to the
// session client's, and lib/x/writer.ts takes either without a cast.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The scheduler worker cannot run without it.",
    );
  }

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Nothing to persist: this client is never a browser session.
      },
    },
  });
}
