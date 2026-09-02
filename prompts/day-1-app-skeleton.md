# Launchpad — Day 1 Implementation Prompt (Cursor / Claude Code)

Paste this whole prompt into Cursor or Claude Code as the task instruction for today's session.

---

## Role

You are implementing **Day 1 of 14** for a product called **Launchpad**. Read the whole prompt before writing code. Build exactly what is described below — nothing from later days.

## Product north star (context only — do not build beyond Day 1)

Launchpad is a paid web app where a founder eventually will: interview with Claude to build a Brand Pack, search X via GetXAPI for high-engagement posts in their niche, save posts to a queue, get AI reply drafts, act on X from one connected account, pull engagers into a Warm leads list, generate outreach drafts and export CSV, and pay via Stripe ($0 free vs $29/mo Operator).

None of that ships today. Day 1 exists so that every later day has a real app, a real database, and a real login to build on top of — not a blank repo.

## Day 1 goal

**A working app skeleton a user can sign into.** Tonight, in a browser: sign up, log in via magic link, log out, see four sidebar nav items, see the Home empty state, refresh the page without losing the session, and never hit a crash or a 404 for any nav item.

## Non-goals (explicitly do NOT build today)

- No Anthropic/Claude API calls, no interview flow, no Brand Pack generation.
- No GetXAPI integration, no X search, no tweet fetching.
- No Stripe integration, no billing/paywall logic, no plan gating.
- No reply/like/follow actions, no draft generation, no CSV export.
- Do not stub these with fake/mocked API calls either — just don't wire them. Coming-next pages are static, not fake-functional.

## Tech stack (Day 1 slice)

- **Next.js App Router + TypeScript** (latest stable, `create-next-app` with TypeScript, ESLint, Tailwind, `src/` dir, App Router — all yes).
- **Tailwind CSS** for styling (ship with the create-next-app default config, no design system needed today — clean and readable is enough).
- **Supabase** for Postgres + Auth. Use `@supabase/supabase-js` and `@supabase/ssr` (not the deprecated auth-helpers package) so session cookies work correctly in Server Components, Route Handlers, and Middleware.
- **Magic-link auth only.** No password auth, no OAuth providers today.
- Package manager: npm (or whatever this repo already standardizes on — check for a lockfile before choosing).

## What to build

### 1. Project scaffold

- Initialize the Next.js app at the repo root (or confirm one already exists and extend it — check first).
- Set up `src/app`, `src/components`, `src/lib` directories.
- Add a `.env.local.example` (see Env vars section) and make sure `.env.local` is gitignored.

### 2. Supabase wiring

- Create `src/lib/supabase/client.ts` — browser client via `createBrowserClient` from `@supabase/ssr`.
- Create `src/lib/supabase/server.ts` — server client via `createServerClient`, reading/writing cookies from `next/headers`, for use in Server Components and Route Handlers.
- Create `src/middleware.ts` — refreshes the Supabase session on every request (per `@supabase/ssr` recommended middleware pattern) so sessions persist across refresh and don't silently expire. Middleware should also gate access:
  - Unauthenticated user hitting any `/(app)` route → redirect to `/`.
  - Authenticated user hitting `/` or `/login` → redirect to `/home`.
- Add a SQL migration file (see Tables section) under `supabase/migrations/`. If the Supabase CLI is available, use `supabase migration new` conventions for the filename; otherwise hand-write a single timestamped `.sql` file.

### 3. Database tables

Create all seven tables today even though only `users` is actually read/written by Day-1 code. This is intentional — later days extend these, they don't invent new ones. Keep columns minimal; later days will add columns via new migrations, not by redesigning these.

```sql
-- users: mirrors auth.users, one row per authenticated person
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

-- brand_packs: output of the Day 3ish interview-with-Claude flow
create table if not exists public.brand_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content jsonb,
  created_at timestamptz not null default now()
);

-- tweets: posts saved from Radar into the Launchpad queue
create table if not exists public.tweets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tweet_id text not null,
  author_handle text,
  content text,
  metrics jsonb,
  status text not null default 'saved',
  created_at timestamptz not null default now()
);

-- drafts: AI reply drafts per saved tweet
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  tweet_id uuid not null references public.tweets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text,
  created_at timestamptz not null default now()
);

-- leads: repliers/retweeters pulled into the Warm list
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_tweet_id uuid references public.tweets(id) on delete set null,
  handle text not null,
  source_type text, -- 'replier' | 'retweeter'
  outreach_draft text,
  created_at timestamptz not null default now()
);

-- actions: log of reply/like/follow clicks taken from the app
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null, -- 'reply' | 'like' | 'follow'
  target_tweet_id uuid references public.tweets(id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- usage_events: generic event log for billing/analytics later
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Also today:

- Enable Row Level Security on all seven tables.
- Add a simple "owner can do everything with their own rows" policy on each (`auth.uid() = user_id`, and `auth.uid() = id` for `users`). No public/anon policies.
- Add a Postgres trigger (or a Supabase Auth webhook, whichever is simpler in this setup) that inserts a row into `public.users` when a new `auth.users` row is created, defaulting `plan` to `'free'`. This is what makes signup actually populate the `users` table today.

### 4. Logged-out landing page (`/`)

Simple, single page: product name ("Launchpad"), one short one-liner describing what it does, and a "Get started" button/link that goes to `/login`. No pricing, no feature list, no footer links needed today.

### 5. Login (`/login`)

- Email input + "Send magic link" button, calling `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: ... } })`.
- Show a simple "Check your email" confirmation state after sending.
- Add the callback route: `src/app/auth/callback/route.ts` (or `/auth/confirm`, match whatever redirect URL you configure) that exchanges the code for a session using the server Supabase client, then redirects to `/home`.

### 6. Logged-in app shell

- Route group `src/app/(app)/layout.tsx`: persistent sidebar with exactly these five nav items, in this order: **Home, Radar, Launchpad, Leads, Settings**.
- Each nav item routes to its own page under `(app)`: `/home`, `/radar`, `/launchpad`, `/leads`, `/settings`.
- Sidebar highlights the active route.
- Settings page (or the sidebar itself) includes a working **Log out** button that calls `supabase.auth.signOut()` and redirects to `/`.

### 7. Page content

- **`/home`**: empty state with the exact message **"Tell the product what you sell"** and no functioning button behind it yet (a disabled or placeholder CTA is fine — do not wire it to anything, since the interview flow doesn't exist yet).
- **`/radar`**, **`/launchpad`**, **`/leads`**: each renders a simple "Coming next" page (page title + one line like "Radar is coming next" — real content, not a 404, not a broken import).
- **`/settings`**: shows the logged-in user's email and the Log out button. Nothing else needed today.

## File list (expected result)

```
.env.local.example
supabase/migrations/<timestamp>_day1_schema.sql
src/middleware.ts
src/lib/supabase/client.ts
src/lib/supabase/server.ts
src/app/layout.tsx
src/app/globals.css
src/app/page.tsx                      # logged-out landing
src/app/login/page.tsx
src/app/auth/callback/route.ts
src/app/(app)/layout.tsx              # sidebar shell
src/app/(app)/home/page.tsx
src/app/(app)/radar/page.tsx
src/app/(app)/launchpad/page.tsx
src/app/(app)/leads/page.tsx
src/app/(app)/settings/page.tsx
src/components/Sidebar.tsx
src/components/LogoutButton.tsx
```

## Env vars (`.env.local.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

(No service-role key, no Anthropic key, no GetXAPI key, no Stripe key today — those get added on the days that use them.)

## Acceptance checks (must all pass tonight, in a real browser)

1. `npm run dev` starts with no build errors.
2. Visiting `/` while logged out shows the landing page with product name, one-liner, and a "Get started" link — no crash.
3. Clicking "Get started" reaches `/login`.
4. Entering an email and requesting a magic link shows a "check your email" confirmation and actually sends a Supabase magic-link email.
5. Clicking the magic link in the email lands the user back in the app, authenticated, on `/home`.
6. A new row appears in `public.users` for that person with `plan = 'free'`.
7. The sidebar shows exactly four nav items — Home, Radar, Launchpad, Leads — plus Settings, and each one navigates to a real page (no 404s).
8. `/home` shows the empty state text "Tell the product what you sell".
9. `/radar`, `/launchpad`, `/leads` each show a "Coming next" page, not a 404 or blank screen.
10. Refreshing the browser on any `/(app)` page keeps the user logged in (session persists via middleware/cookies).
11. Visiting `/` or `/login` while already logged in redirects to `/home` instead of showing the logged-out page again.
12. Clicking Log out ends the session, and refreshing or visiting any `/(app)` route afterward redirects to `/`.
13. All seven tables (`users`, `brand_packs`, `tweets`, `drafts`, `leads`, `actions`, `usage_events`) exist in Supabase with RLS enabled, even though only `users` has rows today.
14. No Anthropic, GetXAPI, or Stripe code, keys, or dependencies were added.
