-- Launchpad Day 1: full schema skeleton.
-- Only `users` is populated today; the rest exist so later days can extend
-- them without a rewrite.

-- USERS: profile row, 1:1 with auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- BRAND_PACKS: filled by the Claude interview (later day). Empty today.
create table public.brand_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_summary text,
  icp text,
  voice_notes text,
  raw_interview jsonb,
  created_at timestamptz not null default now()
);

-- TWEETS: GetXAPI search results saved to the queue (later day).
create table public.tweets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  x_tweet_id text not null,
  author_handle text,
  content text,
  engagement_score numeric,
  status text not null default 'queued', -- queued | drafted | actioned | dismissed
  created_at timestamptz not null default now()
);

-- DRAFTS: Haiku-generated reply drafts, 3 per tweet (later day).
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  tweet_id uuid not null references public.tweets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  variant int not null default 1,
  draft_text text,
  status text not null default 'draft', -- draft | sent | discarded
  created_at timestamptz not null default now()
);

-- LEADS: repliers/retweeters pulled into the Warm list (later day).
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  x_username text not null,
  source text, -- replier | retweeter
  tweet_id uuid references public.tweets(id) on delete set null,
  status text not null default 'new', -- new | drafted | exported | contacted
  created_at timestamptz not null default now()
);

-- ACTIONS: audit log of human-clicked reply/like/follow (later day).
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null, -- reply | like | follow
  target_tweet_id uuid references public.tweets(id) on delete set null,
  target_username text,
  status text not null default 'pending', -- pending | success | failed
  created_at timestamptz not null default now()
);

-- USAGE_EVENTS: for plan gating & analytics once Stripe lands (later day).
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- RLS: every table, owner-only access
alter table public.users enable row level security;
alter table public.brand_packs enable row level security;
alter table public.tweets enable row level security;
alter table public.drafts enable row level security;
alter table public.leads enable row level security;
alter table public.actions enable row level security;
alter table public.usage_events enable row level security;

create policy "users can view own row" on public.users
  for select using (auth.uid() = id);
create policy "users can update own row" on public.users
  for update using (auth.uid() = id);

create policy "owner full access" on public.brand_packs for all using (auth.uid() = user_id);
create policy "owner full access" on public.tweets for all using (auth.uid() = user_id);
create policy "owner full access" on public.drafts for all using (auth.uid() = user_id);
create policy "owner full access" on public.leads for all using (auth.uid() = user_id);
create policy "owner full access" on public.actions for all using (auth.uid() = user_id);
create policy "owner full access" on public.usage_events for all using (auth.uid() = user_id);
