-- SCHEDULER: the founder's own posts, written here and sent by a worker.
--
-- Everything else in this app is a comment under someone else's post,
-- sent by a human pressing a button while signed in. A scheduled post is
-- the first thing the app sends with nobody watching, and that is the
-- whole reason this table looks the way it does: the row is the only
-- record of an intention that has to survive until a worker picks it up,
-- and the only place a failure at 07:00 can be found at 09:00.
--
-- One post per row. Threads are deliberately not modelled — V1 sends a
-- single post, and adding a thread later is a `segments jsonb` column
-- plus a loop in the worker, not a reshaping of this table.
create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null,

  -- draft     — saved, no time on it yet
  -- scheduled — has a scheduled_at, waiting for the worker
  -- claimed   — a worker run has taken it and is posting it now
  -- posted    — it went out; posted_x_tweet_id is the proof
  -- failed    — attempts ran out, last_error says why
  -- canceled  — the founder pulled it before it went
  status text not null default 'draft',

  -- Always UTC, like every other timestamp in this app. The Eastern time
  -- the founder types and reads is a conversion done in the browser
  -- (lib/time/eastern.ts) — the database never stores a local time, so
  -- there is no zone to get wrong when the worker reads this row.
  scheduled_at timestamptz,

  -- How many worker runs have taken this row. Incremented at claim, not
  -- at success, so a run that dies mid-post still costs an attempt and a
  -- permanently poisonous row cannot loop forever.
  attempts int not null default 0,
  claimed_at timestamptz,
  last_error text,

  posted_at timestamptz,
  posted_x_tweet_id text,

  -- composer  — typed by hand
  -- sharpened — the founder's text, rewritten once by Haiku
  source text not null default 'composer',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The worker's read: due rows, oldest first. Partial, because the table
-- is mostly posted rows within a week and the worker never looks at one.
create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (scheduled_at)
  where status in ('scheduled', 'claimed');

-- The dashboard's read: this founder's posts, newest first.
create index if not exists scheduled_posts_user_idx
  on public.scheduled_posts (user_id, created_at desc);

-- The daily cap's read: today's sends for this founder.
create index if not exists scheduled_posts_posted_idx
  on public.scheduled_posts (user_id, posted_at)
  where status = 'posted';

alter table public.scheduled_posts enable row level security;

create policy "owner full access" on public.scheduled_posts
  for all using (auth.uid() = user_id);

-- Hands the caller the posts that are due and marks them claimed in the
-- same statement.
--
-- This exists as a function rather than a select-then-update from the
-- worker because two cron runs can overlap — a slow run still holding
-- rows when the next minute fires — and a select followed by an update
-- would let both take the same row and post it twice. `for update skip
-- locked` makes the second run step over what the first is already
-- holding, which is the one guarantee that matters here: X has no
-- idempotency key, so a double claim is a double post on a real account.
--
-- A row stuck in `claimed` for more than ten minutes is taken back. That
-- is a worker that died between claim and post, and without this line
-- the row would sit in `claimed` forever with nobody looking at it.
create or replace function public.claim_due_scheduled_posts(batch_size int default 10)
returns setof public.scheduled_posts
language sql
security definer
set search_path = public
as $$
  update public.scheduled_posts p
  set status = 'claimed',
      claimed_at = now(),
      attempts = p.attempts + 1,
      updated_at = now()
  where p.id in (
    select id
    from public.scheduled_posts
    where attempts < 3
      and (
        (status = 'scheduled' and scheduled_at <= now())
        or (status = 'claimed' and claimed_at < now() - interval '10 minutes')
      )
    order by scheduled_at
    limit batch_size
    for update skip locked
  )
  returning p.*;
$$;

-- Only the worker may call it, and the worker holds the service role
-- key. A signed-in browser must never be able to claim a row: claiming
-- is what decides a post is going out now.
revoke all on function public.claim_due_scheduled_posts(int) from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_posts(int) to service_role;
