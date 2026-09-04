-- Network: watch a set of X accounts and triage their latest posts from a
-- solitaire-style card stack, sending the good ones into the Launchpad
-- queue.
--
-- Two ingest paths feed network_tweets, which is why the dedupe constraint
-- below matters more than usual:
--   * polling  GET /twitter/user/tweets on page load and on Refresh
--   * pushing  POST /twitter/monitor/add -> our webhook, for new posts
-- GetXAPI monitoring is forward-only from a baseline taken at creation
-- ("there is no backfill"), so polling is the path that actually fills a
-- stack; the monitor only ever adds posts made after you started watching.

create table public.network_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  handle text not null,                 -- bare, no leading "@"
  display_name text,
  avatar_url text,
  bio text,
  followers_count integer,
  monitor_id text,                      -- GetXAPI monitor UUID, null when poll-only
  monitor_status text not null default 'none',  -- none | active | paused
  monitor_error text,                   -- why monitoring is off, shown in the UI
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint network_profiles_user_handle_unique unique (user_id, handle)
);

create table public.network_tweets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null references public.network_profiles(id) on delete cascade,
  x_tweet_id text not null,
  content text,
  url text,
  metrics jsonb not null default '{}'::jsonb,
  engagement_score numeric,
  posted_at timestamptz,
  source text not null default 'poll',  -- poll | monitor
  state text not null default 'new',    -- new | sent | skipped
  tweet_id uuid references public.tweets(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Per user, not per profile: the same post can only ever belong to one
  -- stack, and this is what stops a re-poll from resurrecting a card the
  -- user already sent or skipped.
  constraint network_tweets_user_x_tweet_id_unique unique (user_id, x_tweet_id)
);

create index network_tweets_stack_idx
  on public.network_tweets (user_id, profile_id, state, posted_at desc);

-- One webhook per user. The signing secret is returned exactly once by
-- GetXAPI and never again, so it is stored encrypted with the same
-- AES-256-GCM helper that protects the X auth_token/ct0 in Settings.
create table public.network_webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  webhook_id text not null,
  url text not null,
  signing_secret_encrypted text not null,
  created_at timestamptz not null default now(),
  constraint network_webhooks_user_unique unique (user_id)
);

alter table public.network_profiles enable row level security;
alter table public.network_tweets enable row level security;
alter table public.network_webhooks enable row level security;

create policy "owner full access" on public.network_profiles for all using (auth.uid() = user_id);
create policy "owner full access" on public.network_tweets for all using (auth.uid() = user_id);
-- No policy for network_webhooks on purpose: rows are written and read
-- only by the service-role client, because an inbound webhook POST carries
-- no user session to check auth.uid() against.
