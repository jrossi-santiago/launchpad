-- HeatCheck Day 6: cache each search result PAGE separately, keyed by
-- cursor, so "More" pagination doesn't collide with or overwrite the
-- page-1 cache row.
--
-- Postgres unique indexes treat every NULL as distinct from every other
-- NULL, so a nullable `cursor` column can never enforce "one row per page"
-- — two page-1 fetches (both cursor IS NULL) wouldn't collide and every
-- upsert would insert a fresh row instead of updating. Normalize instead:
-- page 1 is always stored with cursor = '' (empty string), never null.

alter table public.radar_search_cache
  alter column cursor set default '';

update public.radar_search_cache
  set cursor = ''
  where cursor is null;

alter table public.radar_search_cache
  alter column cursor set not null;

drop index if exists public.radar_search_cache_lookup_idx;

create unique index radar_search_cache_lookup_idx
  on public.radar_search_cache (user_id, query, product, min_faves, range_hours, cursor);
