-- Launchpad Day 5: Radar search cache.
-- Caches GetXAPI advanced-search results per user+query+params for 6 hours
-- so a repeat search doesn't burn a GetXAPI call or a usage event.

create table public.radar_search_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  query text not null,
  product text not null default 'Top',       -- 'Top' | 'Latest' — only 'Top' is used today;
                                               -- column exists so Day 6's tab doesn't need a migration
  min_faves int not null default 20,
  range_hours int not null default 72,        -- 24 | 72 | 168
  cursor text,                                -- unused today (always null); Day 6 pagination
  next_cursor text,                           -- whatever GetXAPI returns, stored even though the
                                               -- Day 5 UI ignores it, so Day 6 has data to build on
  results jsonb not null,                     -- array of mapped RadarResult objects
  fetched_at timestamptz not null default now()
);

create unique index radar_search_cache_lookup_idx
  on public.radar_search_cache (user_id, query, product, min_faves, range_hours);

alter table public.radar_search_cache enable row level security;

create policy "owner full access" on public.radar_search_cache
  for all using (auth.uid() = user_id);
