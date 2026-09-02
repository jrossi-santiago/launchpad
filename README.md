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
    launchpad/page.tsx        "Coming next" placeholder
    leads/page.tsx            "Coming next" placeholder
    settings/page.tsx         Email, plan, logout
components/                 Sidebar, ComingNext, LogoutButton
lib/supabase/              Browser + server Supabase clients (@supabase/ssr)
proxy.ts                    Refreshes the Supabase session cookie on every request
                             (Next.js 16's renamed middleware.ts)
supabase/migrations/        Full 7-table schema, RLS enabled
```
