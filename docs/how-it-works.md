# HeatCheck — what it is, and how to use it

A guide for someone who has never opened it. The README next door is for
people changing the code; this is for people using it.

---

## The idea in one paragraph

Posting into an empty room does not get you customers. Being the most
useful person in a thread that already has an audience does. HeatCheck is
built around that one bet: most of your time goes into **other people's
threads**, where the readers already are, and the rest goes into your own
posts, where the recognition you earned has somewhere to land.

The app's job is to make a good comment cheap to produce and fast to send.
It reads the posts, writes a comment in your voice, and hands it to you to
approve. **It never posts anything on your behalf.**

---

## Who this is for

A founder, operator or solo builder who:

- sells something specific enough to describe in a sentence,
- has 20 minutes a day, not two hours,
- would write good replies if the blank box and the scrolling were not the
  bottleneck.

If you have nothing to sell and no opinion about your field, the app will
happily write you 180 characters of nothing. It works because *you* know
things; it is a typing-speed tool, not a knowing-things tool.

---

## One-time setup

### 1. The Brand Pack (required — everything reads from it)

**You → Brand Pack.** A five-question interview:

| Question | Why it is asked |
| --- | --- |
| What do you sell? | Becomes your positioning — the only thing that can appear in a call to action |
| Who is it for? | Your ICP. Used to decide which posts are on your turf |
| What should someone do next? | The action a CTA asks for |
| Two example posts of yours | Voice samples. The model copies how you talk, not what you said |
| What do you never say? | Hard guardrails. These override every other instruction |

From that it generates your positioning, 3–5 ICP bullets, voice notes, and
**8 reply templates** — canned lines in your voice that show up instantly
in the reply sheet with no model call and no cost.

Nothing else in the app works until this exists. HeatCheck and the Queue
both redirect you here.

### 2. Connect X (optional, but you want it)

**You → Connect X account.** Official OAuth. Without it you can still copy
comments and paste them into X yourself; with it you also get one-tap
**likes**, and follows.

You do **not** need it to try the app.

---

## The daily loop

The intended session is about 20 minutes, in this order.

### 1. Commenter → Feed — press **Reload** (~1 min of waiting)

Polls every account you watch, takes their newest posts from the last 24
hours, and has Claude Haiku read each one and write a reply for it. When
it finishes it tells you what it did: *"7 replies written, 2 already had
one, 3 left for you to read, none needed your field."*

Now scroll. Each card is a post with a reply already sitting under it.

### 2. Work down the stream

Per card you have four moves:

- **Copy & open X ↗** — takes the written reply, copies it, and opens X's
  reply composer on that post with the text already in it. You read it,
  edit if you want, press Post. **This is the main action.**
- **More replies** — opens the sheet for other options (below).
- **♡** — likes the post as your account, one tap, no composer. A like is
  not a decision to stop replying, so the card stays.
- **Done** — clears it for good. It never comes back.

### 3. HeatCheck — once, when you have a spare 30 seconds

A different question: not "what did my people post" but "**what is hot in
my niche right now**". One press searches the last 24 hours, ranks by
actual performance, and has Claude Sonnet read the top 10 and write one
comment each. Takes about 18 seconds.

Three a day. Use them when you can post within the hour — the whole point
is being early to something already moving.

### 4. Scheduler — your own post

Not built yet. This is where writing and scheduling your own posts will
live. For now, post from X.

---

## The four tabs

### Scheduler
Placeholder. Your own posts, written with AI help and lined up. The tab
exists ahead of the feature so the navigation never has to move.

### HeatCheck
The hottest posts in your niche in the last 24 hours, one comment each.
Uses the bigger model (Sonnet) because deciding *what kind* of comment a
stranger's winning post can carry is judgement, not typing. It picks
between three postures per post:

- **Value add** — bring something of your own to the subject
- **Grok question** — tag `@grok` with a real question the thread wants answered
- **Pitch** — only when the post is about the exact problem you solve

Cards live in the page and nowhere else — leave the tab and they are gone.
That is deliberate: HeatCheck is about *now*.

### Commenter
The daily loop, in two views (segmented header at the top):

- **Feed** — every watched account's new posts in one stream, newest
  first, with replies written for them.
- **Queue** — posts you kept, each with three drafts written specifically
  for it: two replies of different types, plus a `@grok` question. Posts
  arrive here from the Feed, from HeatCheck, or by pasting a tweet URL.

### You
Everything that is about you rather than about today:

- **Network** — the accounts you watch (up to 25), as one card stack per
  person. The desktop view for triaging one person at a time.
- **Leads** — people pulled from an audience: everyone who replied to or
  retweeted a given post, with an outreach draft written for each.
- **Brand Pack** — positioning, ICP, voice, templates.
- Plan, X connection, logout.

---

## How comments are written

This is the part worth understanding, because it is what makes the output
usable rather than the usual AI slop.

### Every comment is one of exactly four shapes

| Type | When it fits | What it must contain |
| --- | --- | --- |
| **Operator add-on** | You did the thing and know what happened | A real number — %, count, price, duration |
| **Receipts story** | You lived it, and the story is the useful part | First person, past tense, and a figure |
| **Respectful counterpoint** | Right in its scope, wrong just outside it | The turn — *"true for B2C. In B2B…"* |
| **Sharp question** | Nothing first-hand to add, but something specific you want to know | A question mark, and a question that names what it is asking |

Three things make this real rather than decorative:

1. **The type is picked before the comment is written**, not labelled
   afterwards.
2. **The text is checked against the shape it claimed.** An operator
   add-on with no number gets sent back — and gets told *why*, so the
   retry fixes the actual problem.
3. **There is no fifth type.** "Great post, so true" is not one of the
   four and there is nowhere to escape to. Sharp question is the floor:
   there is always something you genuinely want to know.

The type is shown on the card as a chip, so a "Receipts story" with no
story in it is visible before it goes out.

### Comments are 180 characters, not 280

X's limit was being read as a target and filled with three sentences of
agreement. The budget is a third under the platform limit on purpose, and
the leftover space is held for the CTA.

### The CTA is a separate line you turn on

Every comment stands alone. Where an honest ask exists, it is written
separately, stored separately, and shown as a **+ CTA** chip under the
comment. Whatever is on screen is exactly what gets copied.

Most comments have no CTA, and that is correct. It is only offered when
your positioning was legitimately in play — otherwise the model would
invent an asset you do not have.

### Nothing opens with a verdict

"Great post", "so true", "congrats", "this." — banned at the start of every
comment everywhere in the app. The first line is the only one that shows in
a notification; spending it grading the post spends all of it.

### It is allowed to say it does not understand

When a post turns on a link it cannot open, an image it cannot see, or a
person it does not know, the reply writer **declines** instead of bluffing.
The card shows an amber block — *"One for you to read"* — with its own
account of what it was missing.

That card then gives you three buttons, because you are very often the one
person who *does* know what the post means:

- **Ask @grok** — tags `@grok` with a real question about the post, so it
  answers publicly in the thread. Best button on a card that got declined
  because of a link, since Grok can open the link.
- **Ask the author** — turns the gap into the comment. Not understanding a
  post is itself a reason to ask about it. Forced to be a genuine question,
  and it never announces what it could not see.
- **I'll fill the gap** — you type the missing piece in one line ("this is
  his funding announcement, we shipped the same thing last year") and it
  writes the comment treating that as fact.

All three open the reply sheet with the comment in an **editable box**, so
the last edit is always yours.

### Read as

Under each written reply is a line saying what the model thought the post
was about. A wrong reply is almost always a wrong reading, and this makes
that visible in a second instead of never.

---

## The reply sheet

Tap **Reply** / **More replies** on any card:

- **Your templates** — instant, no model call, no cost. The sheet is never
  waiting on anything to be useful.
- **The reply already written** for this post, if there is one.
- **Draft replies for this post** — puts the post in your Queue and writes
  three fresh options for it.

Tapping any of them copies the text and opens X's composer on that post.
On a phone the installed X app claims that link, so you land in the native
composer.

When you come back, it asks *"Did that go up?"* — because there is no
callback from X, and a Mark posted button you have to find later is a
button nobody presses.

---

## Why you always press Post yourself

Since **23 February 2026**, X refuses programmatic replies on every
self-serve API plan. An app may only reply to posts whose author mentioned
or quoted it, which is never true for the replies you want to send.

So the app drafts and **you** send. It is one extra tap, and it is not
going away without Enterprise API access. Likes and follows are unaffected
— X restricted replies specifically.

The clipboard copy alongside the pre-filled composer is deliberate
redundancy: if X ever stops honouring the pre-fill, your draft is still on
the clipboard and the flow degrades to a paste rather than breaking.

---

## Daily limits

All reset at **midnight UTC**.

| Action | Limit | What one costs |
| --- | --- | --- |
| **Feed Reload / Re-Write** | 12 | Polls every account, up to 30 replies written 4 at a time |
| **Write-one buttons** (declined cards) | 30 | One model call |
| **Draft replies for a post** | 20 | Three drafts for one post |
| **HeatCheck** | 3 | A search plus 10 Sonnet reads |
| **Replies sent** | 8 | — |
| **Likes** | 20 | — |
| **Follows** | 10 | — |

Limits exist to stop a stuck loop spending your API budget, not to ration
the app. The action caps (8 replies, 20 likes) are deliberately low for a
different reason: volume is what gets accounts restricted.

---

## Other numbers worth knowing

- **25 accounts** maximum in your Network.
- **4 posts per account** are kept per poll. An account that posts more
  than that between visits will have its oldest posts miss your Feed.
- **24 hours** — a post is in your Feed while it is new, then leaves on its
  own. The Feed answers "what did my people post since yesterday?", not
  "what have I failed to deal with?" There is no backlog to clear.
- **3 minutes** — an account polled that recently is skipped on page load,
  so re-opening the tab is free. Pull down to force a poll.
- **6 hours** — a written reply is left alone for this long. **Re-Write**
  overrides it and rewrites everything on screen.
- Replies and retweets never enter your Feed. Quote tweets do, with the
  quoted post shown underneath — a quote is the person's own post, and
  usually the better reply opportunity.

---

## What is built, and what is not

**Working end to end**

- Magic-link sign-in
- Brand Pack interview and editing
- Network: watch up to 25 accounts, poll their latest posts
- Commenter Feed: Reload, Re-Write, per-post replies, likes, Done
- The three write-one buttons on declined cards
- Commenter Queue: three drafts per post, regeneration, mark posted
- HeatCheck: three runs a day, ten posts, one comment each
- Leads: pull an audience from a post, outreach drafts, CSV export
- X connection via official OAuth; likes and follows post for real

**Not built**

- **Scheduler** — the tab is a placeholder. Standalone posting already
  works underneath; what is missing is a queue table and a worker.
- **Billing** — there is a `plan` field and nothing reads it.
- **Anything on a timer.** Nothing polls, writes or posts in the
  background. Every model call and every X call happens because someone
  pressed a button.

**Removed** — Radar and Explore (keyword search for strangers). Both
competed with HeatCheck for the same minutes with weaker signal: a keyword
match tells you a post is about your topic, not that it is worth being
early to. `docs/sunset/radar-explore.md` has the details.

---

## Running it yourself

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev
```

Push `supabase/migrations/` to your Supabase project, enable magic-link
auth, and add `http://localhost:3000/auth/callback` as a redirect URL.

**The app runs with no API keys at all.** Every integration has a mock
path, so you can click through the whole product before paying for
anything:

| Key | Missing means |
| --- | --- |
| `ANTHROPIC_API_KEY` | Comments come back as visible `[Mock]` placeholders |
| `GETX_API_KEY` | Posts and search results are mock data |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | Likes and follows are simulated, not sent |

Reads (posts, search, audiences) go through GetXAPI because nothing is at
risk and it is far cheaper. Writes (likes, follows, posts) go through the
official X API, because every write is a visible action by your account
and official OAuth is the only way to do that without risking a
restriction.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Brand Pack** | Your positioning, ICP, voice and templates. Every generator reads from it |
| **Card** | One post, with whatever the app has written for it |
| **Reload** | Poll every watched account and write a reply for each new post |
| **Re-Write** | Throw out every reply on screen and write them all again |
| **Sweep** | One Reload's worth of replies. Cards from the newest sweep are marked *Written for this post*; older ones are marked *Old* |
| **Decline** | The model read a post and said it could not follow it, instead of bluffing |
| **On territory** | A post judged to be genuinely about your field. Only these get your positioning in context — at most one card in five, and never more than 4 per sweep |
| **CTA** | The optional one-line ask under a comment. Off by default |
| **Queue** | Posts you kept, with three drafts each |
