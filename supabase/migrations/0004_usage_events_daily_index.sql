-- Speeds up the daily regeneration-cap check, which runs on every
-- /launchpad page load and every regenerate click.
create index usage_events_user_event_created_idx
  on public.usage_events (user_id, event_type, created_at desc);
