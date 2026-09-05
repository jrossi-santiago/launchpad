# HeatCheck: what has to change before anyone can pay

Written against the tree at `5f7dd81`. Every claim below is a fact about
the code, not an impression — file references included so each one can be
checked or argued with.

---

## 1. The three findings that matter

### There is no way to give you money

`users.plan` exists (`0001_init.sql`), defaults to `'free'`, is rendered in
two places (`app/(app)/you/page.tsx:123`, `components/Sidebar.tsx:86`) and
is **read by nothing else in the codebase**. Not one route, guard or
generator branches on it. Stripe is three commented-out lines in
`.env.example`.

Every limit in the app is a module-level constant, identical for everyone:

| Limit | Value | File |
| --- | --- | --- |
| Replies / day | 8 | `lib/usage/actions.ts:4` |
| Likes / day | 20 | `lib/usage/actions.ts:4` |
| Follows / day | 10 | `lib/usage/actions.ts:4` |
| Regenerations / day | 20 | `lib/usage/regenerations.ts:4` |
| Feed reloads / day | 12 | `lib/usage/feedReloads.ts:7` |
| HeatCheck runs / day | 3 | `lib/usage/heatChecks.ts:7` |
| Watched accounts | 25 | `lib/network/stack.ts:23` |
| Live pipeline leads | 10 (default 5) | `lib/pipeline/rules.ts:9` |

The tell is `REPLY_LIMIT_OVERRIDES_BY_EMAIL` in `lib/usage/actions.ts:10`:
a hardcoded map raising one email to 50 replies/day. That is a plan tier,
implemented as a source-code edit and a redeploy. The product already
needs tiering badly enough that it grew one by hand.

Meanwhile the cost side is fully live. Sonnet on every HeatCheck card
(`lib/anthropic/heatcheck.ts:39`, 10 reads per run, 3 runs/day), Haiku on
six other paths, GetXAPI polling 25 accounts per user per refresh, and X
pay-per-use on writes. **Today, every signup is pure burn with no
mechanism to ever become revenue.**

### Nobody can see the product before committing to it

The only door is `/login` → type email → leave the site → find the magic
link → come back (`app/login/page.tsx`). Then `/heatcheck` and
`/commenter/queue` both `redirect("/you/brand-pack")` until a Brand Pack
exists — which means a 312-line Sonnet interview
(`components/brand-pack/InterviewWizard.tsx`) *and*, since `5f7dd81`,
writing down your real business results and misses in the Proofs editor
(`components/brand-pack/ProofsEditor.tsx`, 246 lines).

So a stranger must: surrender an email, break flow for an inbox round
trip, answer an interview, and disclose real revenue figures — **before
seeing a single comment the product would write.** Time-to-first-value is
somewhere north of fifteen minutes of work, all of it spent on faith.

The waste in this is the sharp part: the app runs end to end with **no API
keys at all**. `buildMockHeatCheckRead()`, the mock Brand Pack path, the
mock tweet fetch, and the deterministic mock writer in `lib/x/writer.ts`
already exist and are already maintained. A public, no-signup demo costs
nothing per visitor and is mostly wiring that is already written.

The landing page is 30 lines (`app/page.tsx`): one headline, one
paragraph, one button. No pricing, no screenshot, no proof, no email
capture, no second page for anyone who is interested but not ready.

### You are collecting the one number that would sell this, and showing it to nobody

`pipeline_comment_events.they_replied` and `pipeline_leads.their_reply_count`
(`0022_room_pipeline.sql`) record whether a comment earned a reply.
`network_tweets.reply_type` and `drafts.draft_type` (`0021_comment_types.sql`)
record which of the four comment shapes was used. `drafts.status = 'posted'`
records what actually went out.

Joined, those tables answer: *does an operator add-on earn more replies
than a sharp question?* Nobody — not a user, not you — is shown that.
The README even says it out loud: "which type actually earns replies is a
question the data can answer later." Later is now, because that number is
simultaneously the retention hook, the churn defence, the upgrade
argument, and the only marketing asset a competitor cannot copy.

---

## 2. What you are actually selling (the positioning is wrong)

The landing page says "Find your next customers on X, before your
competitors do." That is the pitch of every lead-gen tool on the market
and it invites the comparison you lose: buyers assume automation, and you
cannot offer automation.

Since **23 February 2026** X refuses programmatic replies on every
self-serve plan (`lib/x/client.ts:125`, `lib/x/writer.ts:125`). Every
reply in HeatCheck is copied and pasted by a human. You correctly refuse
to fake it — `canAutoReply()` hides the button rather than burning a
billed call.

Reframe that constraint as the product. **Nobody can automate this. So the
only edge left is judgement, and judgement is what HeatCheck enforces:**

- Four comment types and no fifth (`lib/anthropic/commentTypes.ts`) — the
  comment the whole feature exists to prevent, agreeing at length, has
  nowhere to escape to.
- Proof gating (`lib/anthropic/proofs.ts`) — with no lived proof, the
  tool's enum does not *contain* "operator add-on." It cannot invent a
  result you never got. That is a narrowed schema, not a prompt asking
  nicely.
- Banned openers, a 180-character budget, a named point generated before
  the comment, `why_specific` proving the reply could not fit any other
  post.
- A live cap of 5 people (`lib/pipeline/rules.ts:10`), and a rules engine
  that only ever *suggests* — no timer moves a lead while you sleep.

That is not a feature list. It is the entire value proposition: **the
discipline of a good reply guy, enforced, at 25 accounts and 5 live
buyers a day.** Sell the restraint. Everything the product refuses to do
is the reason it works, and it is the reason a $39/month price is
defensible while "AI engagement automation" races to $9.

Working headline to test against the current one:

> **You cannot automate a reply that earns a reply.**
> HeatCheck makes you write the one that does — 25 accounts, five live
> buyers, every weekday morning.

---

## 3. Proposed business model

### Pricing axis

Price on **the two things that scale cost and value together**: watched
accounts (Room 1) and live leads (Room 2). Both are already enforced
constants, so tiering them is a config change, not a rewrite.

Do **not** meter replies or comments. Metering the daily commenting habit
makes users ration the exact behaviour the product exists to build, and
the habit is the retention.

| | **Scout** | **Operator** | **Closer** | **Agency** |
| --- | --- | --- | --- | --- |
| Price | Free, no card | **$39/mo** | **$99/mo** | **$299/mo** |
| Watched accounts | 3 | 25 | 25 | 25 × 5 clients |
| Live pipeline leads | — (no Room 2) | 5 | 10 | 10 per client |
| HeatCheck runs / day | 1 | 3 | 6 | 6 per client |
| Replies / day | 5 | 8 | 20 | 20 per client |
| Regenerations / day | 5 | 20 | 60 | 60 |
| Reply-rate report | — | weekly | weekly + by type | + client-ready export |
| X accounts connected | 1 | 1 | 1 | 5 |

Rationale, tier by tier:

- **Scout** is an activation device, not generosity. Three accounts is
  enough to feel the loop and not enough to run a GTM motion on. It has
  no Room 2 at all — the pipeline is the thing worth paying for, so it is
  the thing behind the wall.
- **Operator at $39** is today's product, unchanged, with a price on it.
  It is the current constants exactly. Ship this first; it requires no
  new features, only enforcement.
- **Closer at $99** is where the Scheduler lands when built
  (`/scheduler` is a placeholder today), plus the by-type reply-rate
  analytics. Higher caps alone do not justify 2.5×; the analytics and the
  scheduler do.
- **Agency at $299** is the highest-willingness-to-pay segment and the
  furthest from shipping: `x_connections` has `user_id uuid not null
  unique` (`0007_x_connections.sql`), so one X account per user is a
  schema constraint. Multi-client needs a workspace layer. Do not build
  it until three agencies have asked and one has prepaid.

**One metered exception:** HeatCheck top-up packs. It is the only Sonnet
path and the only genuinely expensive action (10 Sonnet reads per press).
$10 for 20 extra runs. It also gives you a demand signal on the most
loved feature without metering the habit.

### Annual and the first-100 offer

Annual at 2 months free (Operator $390/yr). Cash up front matters more
than MRR optics at this stage, and it removes month-two churn from your
riskiest cohort.

For the first 100 paying accounts: **lifetime price lock at $29**,
announced as ending at 100. It is the only urgency you can honestly
manufacture, and the cohort becomes your case-study supply.

### What to give away, permanently

The **Reply Report** (below). Free forever, no account. It is the top of
the funnel and it costs mock-path pennies.

---

## 4. Reaching more people

The distribution problem is that there is currently no surface between
"never heard of it" and "give me your email." Three things fill that gap,
in order of leverage.

### a. `/demo` — the product, running, no signup

Route the mock paths that already exist to a public page: a canned niche,
five real-looking posts, one comment each with the type chip and the
`why`/`point` fields visible. No auth, no cost, no keys. The call to
action at the bottom is "run this on your niche" → `/login`.

This is the single highest-leverage thing on the list, because it converts
every link anyone shares of the product into a trial instead of a
paywall, and the machinery is already written and maintained.

### b. The free Reply Report (a lead magnet with no marginal cost)

Unauthenticated: paste an X handle. Get back five posts from that niche
and one comment written for each, plus the type each one is. Email
required only to *save* it. This is `heatcheck/run` with the Brand Pack
requirement relaxed to a handle lookup — you already fetch niche posts
(`lib/getx/heatcheck.ts`) and normalise a niche.

Every report is a shareable screenshot with your name on it.

### c. Publish the number nobody else has

Once the reply-rate join exists, you can publish, monthly:

> **Which kind of reply actually earns a reply.** Across N founders and M
> comments: operator add-ons earned a reply X% of the time, sharp
> questions Y%, counterpoints Z%.

No competitor has this data because no competitor stores the type
alongside the outcome. It is a genuine, quotable, linkable statistic, it
is the product's thesis proving itself in public, and it is produced by a
query rather than by writing.

Dogfood it: you are already running yourself at 50 replies/day
(`lib/usage/actions.ts:11`). That is roughly 1,000 replies a month of raw
material. Post the report using your own numbers first.

---

## 5. More conversations

The caps are set for cost control, not for outcomes, and they are
identical for a first-day user and a hundred-day user. Two changes:

**Make the daily loop leave the app.** There is no email, no push, no
digest — the product only exists when someone remembers to open it. A
weekday-morning email — *"7 posts in your Feed, 2 live leads are due a
comment, you're at 3/8 replies"* — is the difference between a tool and a
habit, and habit is the only thing that makes a $39 subscription survive
month three. The pipeline rules engine already computes exactly this
(`suggestions` in `lib/pipeline/rules.ts`); it just has no way to reach
anyone who is not looking at the screen.

**Show people their own reply rate.** A user who cannot see the product
working will churn on the first quiet month. A user who can see "your
comments earned 11 replies this month, 7 of them from operator add-ons"
has a reason to renew and a screenshot to post. Same query as §4c,
filtered to one user.

---

## 6. Risks that pricing has to carry

Charging money changes your obligations. Four things that are tolerable
in a free tool and not in a paid one:

1. **The legacy cookie path.** `lib/x/writer.ts` still falls back to
   pasted `auth_token`/`ct0` via GetXAPI. A paying customer whose X
   account gets restricted is a refund, a support fire and a public post.
   Kill the cookie path before the first invoice; official OAuth only.
2. **Single-vendor read dependency.** GetXAPI is the whole read side
   (Network, HeatCheck, audience pulls). Price with enough margin to
   absorb a swap, and keep `lib/getx/` behind the interface it already
   has.
3. **Policy risk.** X changed the reply rules once, in Feb 2026, and the
   product survived because it never promised automation. Keep that
   promise out of the marketing permanently — it is what makes the next
   policy change survivable too.
4. **Stored credentials become a paid liability.** Encrypted X tokens
   (`lib/security/tokenCrypto.ts`) are already handled well; a paid
   product needs the policy page and the deletion path to match.

---

## 7. Build order, ranked by revenue per unit of work

1. **Stripe + plan enforcement.** Move the eight constants in §1 into a
   plan table keyed off `users.plan`, add checkout and the webhook, gate
   Room 2 behind paid. Delete `REPLY_LIMIT_OVERRIDES_BY_EMAIL` — it
   becomes a plan row. *Nothing else on this list earns a dollar until
   this exists.*
2. **`/demo`** on the existing mock paths. No auth, no cost.
3. **Landing page rebuild**: the four comment types as the pitch, the
   pricing table, a screenshot, and email capture for the not-yet-ready.
4. **Reply-rate report**, per user, weekly email. Retention, upgrade
   argument and marketing asset in one query.
5. **HeatCheck top-up packs.** The only honest place to meter.
6. **Scheduler** — it is the visible hole in the four-tab story and the
   thing Closer is sold on.
7. **Agency workspaces.** Only after three ask and one prepays.

Items 1–3 are the difference between a product that cannot be bought and
one that can. Everything after 3 is optimisation of a funnel that does
not yet exist.
