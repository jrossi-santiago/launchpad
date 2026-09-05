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
    layout.tsx               Sidebar (desktop) + tab bar (mobile) + session check
    home/page.tsx             Empty state
    feed/page.tsx             One stream of every watched account's posts
    explore/page.tsx          Brand-pack searches, one tap each
    radar/page.tsx            "Coming next" placeholder
    network/page.tsx          Card-stack view of watched accounts' latest posts
    launchpad/page.tsx        "Coming next" placeholder
    leads/page.tsx            "Coming next" placeholder
    settings/page.tsx         Email, plan, X connection, logout — the mobile "You" tab
components/                 Sidebar (desktop), TabBar (mobile), ComingNext
components/mobile/          Quick-comment sheet, shared by Feed and Explore
lib/supabase/              Browser + server Supabase clients (@supabase/ssr)
proxy.ts                    Refreshes the Supabase session cookie on every request
                             (Next.js 16's renamed middleware.ts)
supabase/migrations/        Full 7-table schema, RLS enabled
```

## Mobile

The phone build is a different shape on the same data, not a second app.
Under `md:` the sidebar is replaced by a four-destination tab bar —
**Feed**, **Explore**, **Queue** (Launchpad) and **You** (Settings) — and
everything that doesn't fit in four (Network, Radar, Leads, the brand
pack) is one tap deeper, listed on You. Above `md:` nothing changes: the
sidebar and the existing desktop layouts are untouched.

`app/manifest.ts` plus `app/apple-icon.png` make it installable. Opened
from the home screen it runs `standalone`, which is the whole point —
no address bar eating a fifth of the screen — and the viewport is
`viewportFit: "cover"`, which is only safe because the tab bar and the
reply sheet both pad themselves with `env(safe-area-inset-bottom)`.

### Feed

The same cards as Network, in one reverse-chronological stream across
every watched account instead of one column per person. It is
`flattenStacks()` over `loadStacks()` — the same rows, the same
`STACK_WINDOW` per account, the same already-sent-or-skipped filtering —
so there is no second query and no second set of rules to keep in sync.
`POST /api/network/refresh` returns both shapes, `stacks` for the desktop
board and `feed` for the stream, from that one read.

Network keeps its board. The Feed is in addition to it: triaging one
person's stack at a time is still the better view on a laptop, and the
stream is the one that fits a thumb.

Feed actions, in the order the thumb reaches them:

- **Reply** opens the quick-comment sheet (below), which is the point of
  the whole tab.
- **Like** is the one genuinely one-tap action here — X restricted
  replies, not likes, so this is an ordinary official-API call. It posts
  to `/api/tweets/like` with a `card_id`, which resolves the card into a
  `tweets` row (`actions.target_tweet_id` points at that table) and then
  runs the identical like path a Launchpad card does, daily cap and
  duplicate check included. The card's own state is left alone: a like is
  not a decision to stop replying, so the post stays in the Feed.
- **Skip** is `/api/network/skip`, unchanged — the row stays with its
  state flipped, which is what stops the next poll from resurrecting it.
- **Pull down** at the top of the stream sends `force: true`. An ordinary
  visit still polls without it, so the 3-minute poll TTL keeps re-opening
  the tab free.

### Explore

Radar with the search box already filled in. `buildExploreQueries()`
turns each ICP bullet and the positioning line into one chip — lowercased,
punctuation and stopwords dropped, first four content words kept — so the
tab opens on results rather than on an empty input. Every chip is an
ordinary `POST /api/radar/search`, which means the existing search cache
makes a second tap on a chip free, and every result keeps its
`whyItMatched` line.

The chips are deliberately string work rather than a model call: no cost,
no migration, same output every time. If they turn out to be weak in
practice, generating better ones at brand-pack save time and storing them
is a change to that one function's caller.

### Quick comments

The sheet that opens on Reply, from either tab. Two sources, both already
in the app:

- **Your reply templates** (`brand_packs.reply_templates`) — shown
  immediately, no request, no model, no cost. The sheet is never waiting
  on anything to be useful.
- **The three Haiku drafts** written for that specific post, which only
  exist once the post is in the queue. **Draft replies for this post**
  makes the same two awaited calls Radar makes on Add: put the post in
  the queue, then generate.

Tapping a comment copies it and opens `x.com/intent/tweet?in_reply_to=…`
in one gesture — `copyAndOpenReply()` in `lib/x/intent.ts`, shared with
the desktop card. The copy is deliberately not awaited before the open:
awaiting first ends the user-gesture context and mobile Safari swallows
the new tab as a popup. On a phone that URL is claimed by the installed X
app, so it lands in the native composer.

Coming back from X is the only signal that the round trip happened —
there is no callback from the composer — so returning to the tab asks
"Did that go up?" and marks the draft posted, instead of leaving
**Mark posted** as a button to find later. Only drafts can be marked: a
template has no `drafts` row behind it, which is exactly the trade for
it being instant.

## Network

Network watches a set of X accounts and lays their latest original posts out
as one card stack per person, so you can flip through them and send the good
ones into the Launchpad queue (where they get the same three Haiku reply
drafts a Radar result does).

Replies and retweets are filtered out: a stack only ever holds a person's own
original posts. Quote tweets stay, because a quote *is* the person's own post
— and usually the better reply opportunity, since they have already staked
out a position. The card shows the quoted post underneath the commentary, so
"this is exactly right" is not the whole card. GetXAPI does not document the
`quoted_tweet` shape, so it is mapped defensively: a quote it cannot read
costs the card its context block and nothing else.

It is **poll-only, by design**. `GET /twitter/user/tweets` runs when the
Network page loads and when you press Refresh, and keeps the newest
`STACK_WINDOW` (10) original posts per account. There is no background
timer and no webhook: a stack changes when someone is looking at it, and at
no other time. Nothing but `GETX_API_KEY` is needed (without it you get
mock posts, so the page is usable end to end with no keys at all).

GetXAPI's monitoring product would push new posts in real time, but it rents
a plan slot per watched account and its webhook contract — signature header,
signing scheme, delivery payload — is undocumented. Polling costs one request
per account per poll and nothing else, which is why the account cap is 25
(`MAX_PROFILES`) rather than however many monitor slots the plan carries.

Three things keep that cost honest:

- **A poll TTL.** An account polled in the last 3 minutes (`POLL_TTL_MS`) is
  skipped on page load, so re-opening the tab is free. Refresh sends
  `force: true` and polls everything.
- **Bounded concurrency.** Accounts are polled 4 at a time, not serially and
  not all at once.
- **One extra page, at most.** A page of a reply-heavy account can hold only
  a few originals, so when a page comes back under the window and reports
  `has_more`, exactly one more page is fetched.

Cards are never deleted when you send or skip them — the row stays with its
state flipped, which is what stops the next poll from putting a post you
already dealt with back on top of the stack. Ingest is an upsert on
`(user_id, x_tweet_id)` that deliberately leaves `state` alone, so a re-poll
refreshes a card's like/retweet counts without resurrecting a decided one.

The one thing poll-only gives up: if an account posts more than 10 original
posts between two visits, the oldest of them never reach your stack.

## X integration: reads vs. writes

Launchpad talks to X through two providers, split by what the call does:

| | Provider | Why |
| --- | --- | --- |
| **Reads** — Radar search, Network stacks, audience pulls, tweet fetch | GetXAPI (`lib/getx/`) | No account acts, so nothing is at risk; far cheaper than official reads. |
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

### Replies are manual, by X's rule

Since **23 February 2026** X refuses programmatic replies on every
self-serve plan (Free, Basic, Pro, Pay-Per-Use): an app may only reply to
a post whose author @mentioned or quoted it, which is never true for cold
outreach. Only Enterprise and Public Utility apps are exempt.

So for an officially connected account, Launchpad drafts the reply and
you send it. **Copy & Post** copies the draft and opens
`x.com/intent/tweet?in_reply_to=<id>&text=<draft>` in a new tab — X's own
reply composer, already filled in — so sending is one click there and
**Mark posted** back in Launchpad. The clipboard copy is deliberate
redundancy: if X ever stops honouring the `text` parameter, the draft is
still on the clipboard and the flow degrades to a paste rather than
breaking. `canAutoReply()` in
`lib/x/writer.ts` hides the Post button and refuses the API call before it
is billed. Likes, follows and standalone posts are untouched — X
restricted replies specifically.

If you obtain Enterprise or Public Utility access, set
`X_ENTERPRISE_REPLY_ACCESS=true` to turn the Post button back on.

### Adding a scheduler later

`postAs(supabase, connection, text, replyToTweetId)` already posts a
standalone post when `replyToTweetId` is `null`. A scheduler needs a
queue table and a worker that calls it — no new provider code, and no
change to how tokens are refreshed. Standalone posting is deliberately
refused on the legacy cookie path: a steady automated cadence through
scraped cookies is the most restriction-prone pattern there is.
