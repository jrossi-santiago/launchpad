# Launchpad — Day 2 Build Prompt (paste into Claude Code)

## Role & context

You are the sole engineer on Launchpad, a paid web app for founders. The north star: interview with Claude to build a Brand Pack → search X via GetXAPI for high-engagement posts in the niche → save to a queue → get 3 AI reply drafts per post → one-click reply/like/follow from a connected X account → pull repliers/retweeters into a Warm leads list → generate per-lead outreach drafts and export CSV → gate the whole thing behind Stripe.

Day 1 shipped: Next.js App Router + TypeScript + Tailwind, Supabase magic-link auth via `@supabase/ssr`, a protected app shell (Sidebar: Home/Radar/Launchpad/Leads primary nav, Settings pinned separately), and all 7 tables (`users`, `brand_packs`, `tweets`, `drafts`, `leads`, `actions`, `usage_events`) with RLS. `/home` currently shows a static empty state with a disabled "coming soon" button. Everything else (`/radar`, `/launchpad`, `/leads`) is still a placeholder — don't touch those today.

Two things about this codebase that aren't obvious from training data: this Next.js version renamed `middleware.ts` to **`proxy.ts`** (the file already exists at the repo root — don't recreate `middleware.ts`), and `cookies()` from `next/headers` is **async** (`await cookies()`). Follow the existing patterns in `lib/supabase/server.ts` and `app/(app)/layout.tsx` for anything touching auth or the DB.

You are only building Day 2 right now. Do not reach into Radar/search/replies/leads — those are later days.

## Rules that never change

- Human-in-the-loop only. Never build scheduled auto-actions, background jobs, or anything that touches X without a human click.
- Every day ships a clickable UI. If a route or table exists, there's a screen a human can open in a browser tonight.
- Shape things so later days extend, not replace. Don't add abstractions beyond what's needed today.

## Day 2 goal

`/home` becomes a 5-step interview that produces an editable Brand Pack, saved to `public.brand_packs`.

**The 5 steps** (one question per step, with Back/Next):
1. What you sell
2. Who it's for
3. Desired next action (what you want someone to do after a good interaction — reply, DM, visit a link, etc.)
4. 1–2 example posts (paste text of real or representative posts in your niche)
5. What you never say (tone/topics to avoid)

**Flow:**
- No saved pack yet → Home shows the existing empty-state copy, with the "Start Brand Pack interview" button now enabled (not disabled) instead of a new screen.
- Clicking it opens the 5-step wizard inline on `/home`. Answers live in client-side React state across all 5 steps.
- Finishing step 5 → POST the answers to a server route → show a spinner → route calls Claude Sonnet once → response is saved to `brand_packs` → client renders the result as **editable fields**.
- Editable fields + a **Save** button that persists edits directly (no AI call).
- A **Redo interview** action, gated by a confirmation step, that restarts the 5 steps and — only after confirming — replaces the existing pack.
- If a pack already exists, loading `/home` (including on refresh) shows the editable pack view directly, not the empty state — this must be read from the DB server-side, not client state, so it survives a refresh.
- If the generate call fails (bad response, network error, Anthropic error), stay on the interview with all 5 answers still filled in, show an inline error, and offer a retry that resubmits the same answers. Never clear the form on error.

## Explicitly out of scope today

- No GetXAPI calls, no X search, no tweet fetching
- No reply/like/follow buttons, no leads, no queue
- No Stripe
- No cron jobs or background workers
- Don't touch `/radar`, `/launchpad`, `/leads`, or the Sidebar

## Schema change

One new column — everything else maps onto what Day 1 already created:

```sql
-- supabase/migrations/0002_brand_pack_reply_templates.sql
alter table public.brand_packs
  add column reply_templates jsonb not null default '[]'::jsonb;
```

Column mapping for the generated pack (no other schema changes — RLS already covers new columns on existing rows):

| Brand Pack field | Column | Shape |
|---|---|---|
| Raw interview answers | `raw_interview` (existing, jsonb) | `{ what_you_sell, who_its_for, desired_next_action, example_posts: string[], never_say }` |
| Positioning | `business_summary` (existing, text) | One paragraph |
| ICP | `icp` (existing, text) | 3–5 bullets, stored as `\n`-joined lines. In the UI, split on `\n` into separate editable bullet inputs (with add/remove) and rejoin with `\n` on save — no need to change the column to jsonb for this. |
| Voice notes | `voice_notes` (existing, text) | Short paragraph capturing tone, explicitly folding in what they said they never say |
| Reply templates | `reply_templates` (new, jsonb) | Array of exactly 8 strings, 1–2 sentences each |

**Replace semantics:** on generate, look up the user's existing `brand_packs` row first. If one exists, `UPDATE` it in place (same `id`). If not, `INSERT`. Never let a user accumulate more than one row — no need for a uniqueness constraint, just do the lookup-then-write in the route handler.

## Anthropic integration

Use plain `fetch` against the Messages API directly — no `@anthropic-ai/sdk` dependency for one call. Force structured output with tool-use rather than parsing free text.

**Exact request:**

```ts
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY!,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    temperature: 0.7,
    system:
      "You are helping a founder build a Brand Pack for Launchpad, a tool that finds high-engagement X posts in their niche and helps them reply in their own voice. Given their interview answers, produce a positioning statement, an ideal customer profile, voice guardrails, and reply templates they can adapt. Keep everything concrete and specific to what they told you — no generic marketing filler. Reply templates should read like something a real person would actually post, not ad copy.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          what_you_sell: answers.what_you_sell,
          who_its_for: answers.who_its_for,
          desired_next_action: answers.desired_next_action,
          example_posts: answers.example_posts,
          never_say: answers.never_say,
        }),
      },
    ],
    tools: [
      {
        name: "save_brand_pack",
        description: "Save the structured Brand Pack derived from the founder's interview answers.",
        input_schema: {
          type: "object",
          properties: {
            positioning: { type: "string", description: "One paragraph describing what they sell and who it's for." },
            icp_bullets: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 5,
              description: "Specific, targetable descriptions of their ideal customer.",
            },
            voice_notes: {
              type: "string",
              description: "Tone and topic guardrails, explicitly incorporating what they said they never say.",
            },
            reply_templates: {
              type: "array",
              items: { type: "string" },
              minItems: 8,
              maxItems: 8,
              description: "8 short reply drafts (1-2 sentences) they could adapt when replying to posts in their niche, matching their voice.",
            },
          },
          required: ["positioning", "icp_bullets", "voice_notes", "reply_templates"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_brand_pack" },
  }),
});
```

**Parsing the response:** find the block in `response.content` where `type === "tool_use"` and `name === "save_brand_pack"`; its `input` field is the structured object matching the schema above. If the request fails, the response has no such block, or `input` doesn't match the expected shape, treat it as an error (surface it to the client per the "don't wipe answers" rule above).

**Mock fallback — required, not optional:** if `process.env.ANTHROPIC_API_KEY` is unset or empty, skip the fetch entirely and build the same shape deterministically from the raw answers, so the full flow (spinner → pack on screen → edit/save → refresh persists) is reviewable with zero external dependencies:

```ts
function buildMockBrandPack(answers: InterviewAnswers) {
  return {
    positioning: `You sell ${answers.what_you_sell} to ${answers.who_its_for}. When someone responds well, the goal is for them to ${answers.desired_next_action}.`,
    icp_bullets: [
      `Interested in or actively discussing: ${answers.who_its_for}`,
      `Posts or engages with content similar to: "${answers.example_posts[0]?.slice(0, 80) ?? "example post"}"`,
    ],
    voice_notes: `Avoid: ${answers.never_say}`,
    reply_templates: Array.from({ length: 8 }, (_, i) =>
      `[Mock reply template ${i + 1}] Related to "${answers.what_you_sell}" — replace ANTHROPIC_API_KEY to generate real ones.`
    ),
  };
}
```

Both paths (real and mock) go through the identical lookup-then-upsert-into-`brand_packs` logic and return the same response contract to the client, so the frontend never needs to know which path ran.

## Files to add / change

```
app/
  (app)/
    home/page.tsx                          [MODIFY] server component: load the user's brand_packs row (if any),
                                             pass it as initial data to <BrandPackHome />
  api/
    brand-pack/
      generate/route.ts                     [NEW] POST — auth check, call Claude (or mock), upsert brand_packs,
                                             return the saved row as JSON
      save/route.ts                         [NEW] POST — auth check, persist edited fields directly, no AI call
components/
  brand-pack/
    BrandPackHome.tsx                       [NEW] client component: switches between empty state / interview
                                             wizard / spinner / error / editable pack views
    InterviewWizard.tsx                     [NEW] the 5-step form, holds answers in state, calls /api/brand-pack/generate
    BrandPackEditor.tsx                     [NEW] editable positioning / ICP bullets / voice notes / 8 reply
                                             templates + Save button + Redo interview (with confirm)
lib/
  anthropic/
    brandPack.ts                            [NEW] buildBrandPackRequest(), callClaude(), buildMockBrandPack(),
                                             and the upsert-by-user_id helper against Supabase
supabase/
  migrations/
    0002_brand_pack_reply_templates.sql     [NEW] adds reply_templates jsonb column
```

Route handlers should get the user the same way `app/(app)/layout.tsx` already does — `createClient()` from `lib/supabase/server.ts`, then `supabase.auth.getUser()` — and return 401 if there's no session. Never trust a user id from the request body.

## Env vars

Move `ANTHROPIC_API_KEY` from "wired later" to "used today" in `.env.example`:

```
# Used today
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=          # optional locally — omit it and the mock Brand Pack path kicks in

# Wired later — do not use yet
# GETX_API_KEY=               (Day 6+: X search/read/write)
# STRIPE_SECRET_KEY=          (Day 12+: billing)
# STRIPE_WEBHOOK_SECRET=      (Day 12+: billing)
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=  (Day 12+: billing)
```

## Acceptance checks — verify in a real browser tonight

- [ ] `npm run dev` starts cleanly, no console errors
- [ ] Fresh user, no pack → `/home` shows the empty state with an enabled "Start Brand Pack interview" button
- [ ] Clicking it walks through all 5 questions, one at a time, with working Back/Next
- [ ] Finishing step 5 shows a spinner, then the generated pack renders on screen
- [ ] Without `ANTHROPIC_API_KEY` set, the mock pack still generates and renders (full flow reviewable with zero external calls)
- [ ] With `ANTHROPIC_API_KEY` set, a real Claude Sonnet call produces a real pack via the `save_brand_pack` tool
- [ ] Pack fields (positioning, ICP bullets, voice notes, all 8 reply templates) are editable, and Save persists the edits without calling Claude again
- [ ] Refreshing `/home` after a pack exists shows the editable pack immediately — no empty state, no re-running the interview
- [ ] "Redo interview" requires confirmation before it replaces the existing pack; canceling leaves the old pack untouched
- [ ] Killing the network (or temporarily pointing `ANTHROPIC_API_KEY` at garbage) during generate shows an inline error and keeps all 5 answers filled in — retry resubmits the same answers, not a blank form
- [ ] `brand_packs` in Supabase shows exactly one row per user after multiple interview runs, with `reply_templates` populated
- [ ] Codebase still has zero references to GetXAPI or Stripe
