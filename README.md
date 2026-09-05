# HeatCheck

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
   land on `/you/brand-pack`, signed in. Fill the brand pack in first:
   HeatCheck and the queue both redirect there until it exists.

## Project layout

```
app/
  page.tsx                 Logged-out landing page
  login/page.tsx            Magic-link sign-in
  auth/callback/route.ts    Exchanges the magic-link code for a session
  (app)/                    Authenticated shell (redirects to /login if signed out)
    layout.tsx               Sidebar (desktop) + tab bar (mobile) + session check
    scheduler/page.tsx        Tab 1 — post creator + scheduling, not built yet
    heatcheck/page.tsx        Tab 2 — today's hottest posts, one comment each
    commenter/                Tab 3 — the daily commenting loop
      layout.tsx               Feed / Queue segmented header
      page.tsx                 One stream of every watched account's posts
      queue/page.tsx           Posts you kept, with drafts written for them
    you/                      Tab 4 — everything that is about you
      page.tsx                 Hub: sections below, plan, X connection, logout
      network/page.tsx         Card-stack view of watched accounts' latest posts
      leads/page.tsx           People pulled from an audience
      brand-pack/page.tsx      Positioning, ICP, voice, reply templates
    feed|launchpad|network|leads|home|settings|radar|explore/
                              One-line redirects to where each moved
components/                 Sidebar (desktop), TabBar (mobile), ComingNext
components/commenter/       Feed / Queue segmented nav
components/mobile/          Quick-comment sheet
lib/supabase/              Browser + server Supabase clients (@supabase/ssr)
proxy.ts                    Refreshes the Supabase session cookie on every request
                             (Next.js 16's renamed middleware.ts)
supabase/migrations/        Full 7-table schema, RLS enabled
docs/sunset/                What Radar and Explore did, before they were removed
```

The route names moved; the component and API directory names did not.
`components/feed/`, `components/launchpad/`, `/api/network/*` and
`/api/radar/add` all still say what they said, so a rename does not show up
as a diff on every file that touches them.

## The four tabs

| Tab | Route | What it is for |
| --- | --- | --- |
| **Scheduler** | `/scheduler` | Your own posts — write with AI help, line them up. Not built yet. |
| **HeatCheck** | `/heatcheck` | The posts in your niche that are hot *right now*, one comment each. |
| **Commenter** | `/commenter` | The daily loop: the accounts you watch, and the queue of posts you kept. |
| **You** | `/you` | Network, Leads, Brand Pack — plus plan, X connection and logout. |

The shape follows one idea: a reply that earns a reply from the author is
worth more than a post of your own, so most of the time goes into other
people's threads (**Commenter**, **HeatCheck**) and the rest into posts that
give the recognition somewhere to land (**Scheduler**). **You** holds the
inputs all three read from — who you watch, who you have talked to, and the
positioning every draft is written against.

Radar and Explore were removed in this restructure. `docs/sunset/radar-explore.md`
records what they did and what is still in the tree.

## Mobile

The phone build is a different shape on the same data, not a second app.
Under `md:` the sidebar is replaced by the four-destination tab bar —
**Scheduler**, **HeatCheck**, **Commenter**, **You** — and the two tabs
that hold more than one view show it the same way on both: Commenter has a
Feed / Queue segmented header, and You lists Network, Leads and the Brand
Pack. Above `md:` the sidebar lists the same four with their sub-pages
nested underneath, so nothing is more than one tap or one click deeper than
the tab it belongs to.

`app/manifest.ts` plus `app/apple-icon.png` make it installable. Opened
from the home screen it runs `standalone`, which is the whole point —
no address bar eating a fifth of the screen — and the viewport is
`viewportFit: "cover"`, which is only safe because the tab bar and the
reply sheet both pad themselves with `env(safe-area-inset-bottom)`.

### Commenter — Feed

The same cards as Network, in one reverse-chronological stream across
every watched account instead of one column per person. It is
`flattenStacks()` over `loadStacks()` — the same rows, the same
`STACK_WINDOW` per account, the same already-sent-or-skipped filtering —
so there is no second query and no second set of rules to keep in sync.
`POST /api/network/refresh` returns both shapes, `stacks` for the desktop
board and `feed` for the stream, from that one read.

Network keeps its board, under You. The Feed is in addition to it: triaging one
person's stack at a time is still the better view on a laptop, and the
stream is the one that fits a thumb.

Feed actions, in the order the thumb reaches them:

- **Reply** opens the quick-comment sheet (below), which is the point of
  the whole tab.
- **Like** is the one genuinely one-tap action here — X restricted
  replies, not likes, so this is an ordinary official-API call. It posts
  to `/api/tweets/like` with a `card_id`, which resolves the card into a
  `tweets` row (`actions.target_tweet_id` points at that table) and then
  runs the identical like path a queue card does, daily cap and
  duplicate check included. The card's own state is left alone: a like is
  not a decision to stop replying, so the post stays in the Feed.
- **Skip** is `/api/network/skip`, unchanged — the row stays with its
  state flipped, which is what stops the next poll from resurrecting it.
- **Pull down** at the top of the stream sends `force: true`. An ordinary
  visit still polls without it, so the 3-minute poll TTL keeps re-opening
  the tab free.

### Reload arrives in pieces

Reload is a poll of every watched account followed by up to
`RELOAD_REPLY_BUDGET` (30) model calls, and it used to be one request that
returned one object — so the Feed showed a spinner for as long as thirty
replies take, and then everything at once. The work is the same length;
what changed is that nothing waits for the end of it.

`POST /api/feed/reload` streams newline-delimited JSON (`ReloadEvent` in
`lib/network/reload.ts`, read by `readNdjson()`):

- **`feed`**, once, as soon as the posts are pulled and before the first
  model call — every card, plus the ids of the ones a reply is coming for.
  This is the event that ends the wait: the posts are readable from here.
- **`reply`**, one per card, as each finishes. A decline or a failure
  arrives here too; settled is settled.
- **`done`**, with the summary and the refreshed allowance.
- **`error`**, terminal. The refusals that happen before the sweep starts
  — no Brand Pack, no allowance, no session — are still ordinary JSON with
  a status code, because nothing has been streamed yet.

Two things follow from streaming that are worth knowing:

- **The order is decided once, up front.** `sortFeedForSweep()` ranks a
  card queued for a reply as though it already has one, because in a few
  seconds it will. Sorting again at the end would be more accurate and
  much worse: by then somebody is reading, and cards moving under a thumb
  mid-read is not a fix.
- **A closed tab does not stop the sweep.** Every reply is written to
  `network_tweets` before it is sent, so an abandoned Reload is unwatched,
  not wasted.

### Two drafts, one call

Every reply the sweep writes is checked against the shape it claimed —
an operator add-on carrying no figure, a receipts story that happened to
nobody, a `why_specific` that says "it is relevant to the topic". A reply
that fails one of those used to earn a corrective retry: a second full
round trip, on a card holding up one of eight lanes.

So `save_reply` now returns **two** replies rather than one, best first,
in different shapes. The checks run over them in order and the first
usable one is sent — which keeps the ranking (`operator` beats
`receipts`, either beats `counterpoint` or `question`), because the model
was asked for its best reply first. The second is a real reply of a
different kind, not a variation on the first: different `comment_type`,
different `point`, and it must stand on its own.

A model that fails a mechanical shape check has usually written a fine
reply of a different kind. Asking for that kind up front costs a few
dozen output tokens; asking for it afterwards costs a whole round trip.

The corrective retry is still there and still one, but it now fires when
*both* drafts fail — a much stronger signal — and it is told exactly what
was wrong with each, rather than "that did not work". Both failing twice
is a decline, which is a correct answer.

Whether the spare draft earns its tokens is a question the data answers
rather than the design: `ReloadSummary` counts `alternate` (replies that
came from the second draft — each one a round trip saved) and `retried`
(cards that needed the extra call anyway), and both land in the
`usage_events` row every Reload writes. A sweep where `alternate` sits
near zero is a sweep paying for a spare it never uses.

### The fields in front of the comment have both ends now

`about`, `point`, `why_specific` and `profile_click` are all generated
*before* the reply — that is the whole mechanism, since tool arguments
come back in schema order and a claim made first is a constraint while one
made afterwards is a label. It is also latency: on a sweep of thirty cards
the padding in front of each comment is a real part of how long the button
takes, paid before a single character of the reply exists.

The floors were never new. `isSubstantivePoint` and its neighbours have
always rejected a field that ran too short, because a justification that
names nothing is the tell that nothing is being justified. What was new is
that **the model was never told what they were** — marked against a
minimum nobody mentioned, which is the reliable way to get an essay: write
long enough and you cannot be too short.

So each field now names both ends, read from the same constant the
validator reads (`POINT_MIN_WORDS` / `POINT_MAX_WORDS` and friends in
`lib/anthropic/comment.ts`), with a `maxLength` alongside because the
schema is the half the model cannot talk itself out of:

| Field | Window | Floor enforced by |
| --- | --- | --- |
| `about` | 6-20 words | `isSubstantiveAbout` |
| `point` | 4-12 words | `isSubstantivePoint` |
| `why_specific` | 5-15 words | `isSubstantiveWhySpecific` |
| `profile_click` | 3-10 words | `isSubstantiveProfileClick` |

A window is a target you can hit; a floor you cannot see is a reason to
keep typing.

The obvious way for this to go wrong is a cap tight enough that fields
start failing their own minimums — which costs a whole draft to save a few
tokens, and after the two-draft change above would push work back onto the
retry. So `ReloadSummary.rejected` counts every draft rejection by the
check that made it (`shape`, `point`, `why_specific`, `profile_click`,
`reply`) and lands in the same `usage_events` row. A cap that is too tight
shows up as its field climbing in that tally, rather than as a surprise.

Replies are written eight at a time (`REPLY_CONCURRENCY`) from a pool
rather than four at a time in waves — a wave runs at the speed of its
slowest member, and the slow member is usually a card paying for its one
corrective retry. What makes eight safe is `lib/anthropic/client.ts`,
which is where every Messages call the sweep makes now goes: it retries
429s, 408s and 5xx with jittered backoff, honours `retry-after`, and gives
up after three attempts rather than holding a card open forever.

### Commenter — Queue

The posts you kept, each with the three Haiku reply drafts written for it,
the regeneration meter and the daily action meter. It was `/launchpad`; it
is `/commenter/queue` now, unchanged otherwise. Posts arrive from the Feed,
from HeatCheck, or from pasting a tweet URL or id.

### Quick comments

The sheet that opens on Reply, from either tab. Two sources, both already
in the app:

- **Your reply templates** (`brand_packs.reply_templates`) — shown
  immediately, no request, no model, no cost. The sheet is never waiting
  on anything to be useful.
- **The three Haiku drafts** written for that specific post, which only
  exist once the post is in the queue. **Draft replies for this post**
  makes the same two awaited calls the queue makes on Add: put the post in
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

### The four comment types

Every comment the app writes is one of exactly four shapes, defined once
in `lib/anthropic/commentTypes.ts` and used by all three generators —
HeatCheck, Feed Reload, and the queue's drafts:

| Type | When it is the right pick | What the text must contain |
| --- | --- | --- |
| **Operator add-on** | You have done the thing the post is about and know what happened | A real figure — the percentage, count, price or duration |
| **Receipts story** | You lived it, and the useful part is what happened rather than a rule | First person (or an implied subject: "Priced it at $9…"), plus a figure |
| **Respectful counterpoint** | The post is right in its scope and wrong just outside it | The turn: a contrast word, or granting the scope first ("true for B2C. In B2B…") |
| **Sharp question** | Nothing first-hand to add, but something specific you want to know | A question mark, and a question that names what it is asking about |

Three things make this a rule rather than advice:

- **The type is chosen before the comment is written.** It is a tool field
  placed ahead of `point` and the comment itself, and tool arguments come
  back in schema order — the same mechanism `point` already ran on. A type
  picked afterwards would be a label, not a decision.
- **The text is checked against the shape it promised.**
  `violatesTypeRule()` is the enforcement: an operator add-on with no
  number, a receipts story that happened to nobody, a counterpoint that
  never turns, a question that asks nothing. It returns the *reason*, and
  the reason is what the corrective retry is given — "that did not work"
  makes a model guess; "an operator add-on needs the figure" makes it fix
  the thing that is wrong.
- **There is no fifth type.** The comment the whole feature exists to
  prevent — agreeing at length — is not one of the four, and there is
  nowhere to escape to. Sharp question is the floor, since there is always
  something you genuinely want to know.

Ranked, too: `operator` beats `receipts` when both are honestly available,
and either beats `counterpoint` or `question`. The rules say to take the
first that is true, and never to pick a shape you cannot fill — an invented
number is worse than a smaller comment.

Separately and regardless of type, a comment may not **open** with a
verdict on the post ("great post", "so true", "congrats", "this."). That
list is `BANNED_OPENERS` in `lib/anthropic/comment.ts` and is checked by
`isUsableComment()`, so it applies everywhere a comment is written. It is
anchored to the start because the first line is the only one that shows in
a notification.

The chosen type is stored (`network_tweets.reply_type`, `drafts.draft_type`)
and shown on the card, so a receipts story with no story in it is visible
before it goes out — and so "which type actually earns replies" is a
question the data can answer later. The `@grok` draft carries no type: it
is its own shape, and labelling it as one of the four would put a badge on
a card that the rules never checked.

### Comment length, and the CTA

Every comment the app writes — HeatCheck's, Feed Reload's, and the queue's
draft options — obeys the same two rules, defined once in
`lib/anthropic/comment.ts`:

- **180 characters, not 280.** X's limit was being read as a target and
  filled: three sentences of agreement where one point would do. The
  budget is now a third shorter than the platform allows, enforced by the
  tool schema *and* by the validators that trigger the corrective retry.
- **A named point, generated before the comment.** Tool arguments come
  back in schema order, so `point` — the one thing this comment adds that
  the post does not already contain — has to exist before the comment can
  be written from it. A comment whose only point is that the post is right
  is sent back to be rewritten.

The remaining characters are held for a **CTA**: one line, 80 characters
or fewer, written by the same call but kept in its own field and its own
column (`network_tweets.suggested_cta`, `drafts.draft_cta`). It is never
appended by the model. The card shows the comment alone and offers a
**+ CTA** chip; whatever is on screen is exactly what the copy button
copies and what the post endpoint sends.

A CTA can only name something real, so it is only asked for when the
founder's positioning is legitimately in the request: HeatCheck (which has
always carried the whole Brand Pack), the few Feed posts the on-territory
gate judged adjacent, and the queue's reply drafts, where the positioning
arrives as a single `offer` field fenced to that one use. Off-territory
Feed replies do not have the field in their tool schema at all, so there
is nothing to invent an asset from. The `@grok` drafts never carry one
either: the point of tagging Grok is a public answer in the thread, and an
ask stapled underneath reads as bait.

## You — Network

Network watches a set of X accounts and lays their latest original posts out
as one card stack per person, so you can flip through them and send the good
ones into the Commenter queue (where they get three Haiku reply
drafts each).

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

HeatCheck talks to X through two providers, split by what the call does:

| | Provider | Why |
| --- | --- | --- |
| **Reads** — Network stacks, HeatCheck, audience pulls, tweet fetch | GetXAPI (`lib/getx/`) | No account acts, so nothing is at risk; far cheaper than official reads. |
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

So for an officially connected account, HeatCheck drafts the reply and
you send it. **Copy & Post** copies the draft and opens
`x.com/intent/tweet?in_reply_to=<id>&text=<draft>` in a new tab — X's own
reply composer, already filled in — so sending is one click there and
**Mark posted** back in the Commenter queue. The clipboard copy is deliberate
redundancy: if X ever stops honouring the `text` parameter, the draft is
still on the clipboard and the flow degrades to a paste rather than
breaking. `canAutoReply()` in
`lib/x/writer.ts` hides the Post button and refuses the API call before it
is billed. Likes, follows and standalone posts are untouched — X
restricted replies specifically.

If you obtain Enterprise or Public Utility access, set
`X_ENTERPRISE_REPLY_ACCESS=true` to turn the Post button back on.

### Adding a scheduler later

The `/scheduler` tab is the placeholder for this.

`postAs(supabase, connection, text, replyToTweetId)` already posts a
standalone post when `replyToTweetId` is `null`. A scheduler needs a
queue table and a worker that calls it — no new provider code, and no
change to how tokens are refreshed. Standalone posting is deliberately
refused on the legacy cookie path: a steady automated cadence through
scraped cookies is the most restriction-prone pattern there is.
