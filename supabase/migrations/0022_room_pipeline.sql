-- Room pipeline: the human comment loop, tracked.
--
-- Room 1 is the existing Network — up to 25 watched accounts whose posts
-- you comment on daily. This migration adds Room 2: a small set of
-- individual buyers you work one at a time, fed by a parking lot.
--
--   waitlist  cap 50   people pulled off a Room 1 post, no work happens
--   live      cap 10   the only people the app ever prompts you to
--                      comment on; the default working cap is 5
--   backlog   cap 200  stale, pitched-no and not-now
--
-- Nothing in here moves a lead on its own. There is no timer job and no
-- trigger that rewrites status: the rules engine in lib/pipeline/rules.ts
-- only ever produces a suggestion, and a button the user presses is what
-- writes the row.

create table public.pipeline_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  handle text not null,                       -- bare, no leading "@"
  display_name text,
  bio_snippet text,
  icp text not null default 'unrated',        -- yes | no | unrated
  -- The Room 1 post they came from, kept as a URL rather than a foreign
  -- key: a lead can be added by pasting a post link that never went
  -- through the Leads pull.
  source_post_url text,
  source_type text,                           -- reply | repost
  -- Set when the row was promoted out of the existing Leads table, so a
  -- second pull of the same audience can tell "already in the pipeline"
  -- from "new person".
  lead_id uuid references public.leads(id) on delete set null,
  status text not null default 'waitlist',
  -- new | waitlist | live | seen_you | conversation | pitched | converted
  -- | stale | backlog | skipped
  moved_to_live_at timestamptz,
  last_our_comment_at timestamptz,
  our_comment_count integer not null default 0,   -- on THEIR posts, while live
  their_reply_count integer not null default 0,   -- replies to US
  their_last_reply_at timestamptz,
  last_signal_at timestamptz,                     -- like or reply to us
  pitched_at timestamptz,
  -- "Keep 7 days" on a Replace suggestion: the suggestion is suppressed
  -- until this passes. Never a status change, just a snooze.
  keep_until timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per person per user. A lead who comes back on a later Room 1
  -- pull updates the row they already have rather than forking into a
  -- second card with a different status.
  constraint pipeline_leads_user_handle_unique unique (user_id, handle)
);

create index pipeline_leads_board_idx
  on public.pipeline_leads (user_id, status, created_at);

-- Append-only. One row per comment the user says they posted on a live
-- lead's post; "they replied" is marked back onto the same row, which is
-- what feeds their_reply_count and the pitch helper's unlock.
create table public.pipeline_comment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  pipeline_lead_id uuid not null references public.pipeline_leads(id) on delete cascade,
  our_comment_url text,
  their_post_url text,
  at timestamptz not null default now(),
  they_replied boolean not null default false,
  their_reply_url text,
  created_at timestamptz not null default now()
);

create index pipeline_comment_events_lead_idx
  on public.pipeline_comment_events (pipeline_lead_id, at desc);

-- How many leads this user works at once. The hard ceiling is 10 and is
-- enforced in code; this is the number they actually run, defaulting to
-- the 5 that a person can keep up with alongside Room 1.
alter table public.users add column pipeline_live_cap integer not null default 5;

alter table public.pipeline_leads enable row level security;
alter table public.pipeline_comment_events enable row level security;

create policy "owner full access" on public.pipeline_leads for all using (auth.uid() = user_id);
create policy "owner full access" on public.pipeline_comment_events for all using (auth.uid() = user_id);
