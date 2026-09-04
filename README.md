# Launchpad

Find your next customers on X, before your competitors do.

This is the **Day 1 skeleton**: a running Next.js app with Supabase
magic-link auth, a protected app shell, and the full database schema the
next 13 days will build on. No AI, X, or billing integrations yet — see
`.env.example` for what's deliberately not wired up.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres + magic-link auth via `@supabase/ssr`)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project, then copy `.env.example` to `.env.local` and
   fill in the values from your project's API settings:

   ```bash
   cp .env.example .env.local
   ```

3. Push the schema in `supabase/migrations/0001_init.sql` to your project
   (via the Supabase SQL editor, or `supabase db push` if you have the CLI
   linked). This creates all 7 tables (`users`, `brand_packs`, `tweets`,
   `drafts`, `leads`, `actions`, `usage_events`) with row-level security
   enabled, plus a trigger that creates a `public.users` profile row
   (defaulting `plan` to `'free'`) whenever someone signs up.

4. In the Supabase dashboard, make sure email (magic link) auth is enabled
   under Authentication → Providers, and add `http://localhost:3000/auth/callback`
   to the allowed redirect URLs under Authentication → URL Configuration.

5. Run the dev server:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000). "Get started" →
   enter your email on `/login` → click the magic link in your inbox → you
   land on `/home`, signed in.

## Project layout

```
app/
  page.tsx                 Logged-out landing page
  login/page.tsx            Magic-link sign-in
  auth/callback/route.ts    Exchanges the magic-link code for a session
  (app)/                    Authenticated shell (redirects to /login if signed out)
    layout.tsx               Sidebar + session check
    home/page.tsx             Empty state
    radar/page.tsx            "Coming next" placeholder
    network/page.tsx          Card-stack view of watched accounts' latest posts
    launchpad/page.tsx        "Coming next" placeholder
    leads/page.tsx            "Coming next" placeholder
    settings/page.tsx         Email, plan, logout
components/                 Sidebar, ComingNext, LogoutButton
lib/supabase/              Browser + server Supabase clients (@supabase/ssr)
proxy.ts                    Refreshes the Supabase session cookie on every request
                             (Next.js 16's renamed middleware.ts)
supabase/migrations/        Full 7-table schema, RLS enabled
```

## Network

Network watches a set of X accounts and lays their latest original posts out
as one card stack per person, so you can flip through them and send the good
ones into the Launchpad queue (where they get the same three Haiku reply
drafts a Radar result does).

Replies and retweets are filtered out: a stack only ever holds a person's own
original posts.

Two things fill a stack, because GetXAPI monitoring is forward-only from a
baseline taken when the monitor is created and has no backfill:

- **Polling** `GET /twitter/user/tweets` runs when the Network page loads and
  when you press Refresh. There is no background timer. This is the path that
  gives a newly watched account a stack at all, and it works with nothing but
  `GETX_API_KEY` set (and returns mock posts without it).
- **Monitoring** `POST /twitter/monitor/add` pushes new posts to
  `/api/network/webhook` as they happen. It needs `NEXT_PUBLIC_APP_URL` set to
  a public HTTPS origin — GetXAPI rejects localhost and private addresses — and
  monitoring enabled on the GetXAPI plan. Without either, a profile falls back
  to poll-only and says so under its stack.

Removing an account calls `POST /twitter/monitor/remove` rather than pausing,
because removal is the only thing that frees the monitoring plan slot. The
per-user cap is 12 accounts.

Cards are never deleted when you send or skip them — the row stays with its
state flipped, which is what stops the next poll from putting a post you
already dealt with back on top of the stack.

## X integration: reads vs. writes

Launchpad talks to X through two providers, split by what the call does:

| | Provider | Why |
| --- | --- | --- |
| **Reads** — Radar search, Network stacks, monitor webhooks, audience pulls, tweet fetch | GetXAPI (`lib/getx/`) | No account acts, so nothing is at risk; far cheaper than official reads. |
| **Writes** — replies, likes, follows (and scheduled posts later) | Official X API v2 (`lib/x/`) | Every write is a visible action by the user's account. Official OAuth is the only way to do that without risking a restriction. |

Routes never pick a provider themselves. They call `postAs`, `likeAs` or
`followAs` in `lib/x/writer.ts`, which decides per connection row:

- `auth_provider = 'oauth2'` with a stored access token, and the server
  configured → official API.
- otherwise a stored cookie pair with `GETX_API_KEY` set → legacy GetXAPI.
- otherwise → the deterministic mock path, so the app stays runnable with
  no keys at all.

That means the migration is per user, not per deploy: someone who
connected with cookies keeps working until they reconnect via
**Settings → Connect X account**.

### Setting up official X access

1. Create an app in the X developer console with OAuth 2.0 enabled as a
   **confidential client**.
2. Register the callback exactly as `<NEXT_PUBLIC_APP_URL>/api/auth/x/callback`.
3. Request scopes `tweet.read tweet.write users.read like.write
   follows.write offline.access`. `offline.access` is not optional — it is
   what makes X issue a refresh token, and without one a connection dies a
   couple of hours after it is made.
4. Set `X_CLIENT_ID`, `X_CLIENT_SECRET` and `NEXT_PUBLIC_APP_URL`.

X's API is pay-per-use (no subscription tier): posts are billed per
create, and a follow costs an extra user lookup because the official
endpoint takes a numeric id rather than a handle. Posts containing a link
are billed at a much higher rate than plain ones — worth knowing before
drafts start including URLs at volume.

### Adding a scheduler later

`postAs(supabase, connection, text, replyToTweetId)` already posts a
standalone post when `replyToTweetId` is `null`. A scheduler needs a
queue table and a worker that calls it — no new provider code, and no
change to how tokens are refreshed. Standalone posting is deliberately
refused on the legacy cookie path: a steady automated cadence through
scraped cookies is the most restriction-prone pattern there is.
