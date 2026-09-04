-- Network becomes poll-only.
--
-- GetXAPI monitoring capped a user at the number of monitor slots their
-- plan carried, and the live-delivery path it bought depended on three
-- contracts GetXAPI never published (the webhook signature header and
-- scheme, the delivery payload shape, and the field names on
-- monitor/add). Polling GET /twitter/user/tweets on page load and on
-- Refresh needs none of that, and the account cap becomes a call budget
-- we control rather than a plan slot we rent.
--
-- What this drops:
--   * network_webhooks entirely — no inbound deliveries to authenticate
--   * network_profiles.monitor_id / monitor_status — nothing to track
-- and what it keeps, renamed: monitor_error held "why monitoring is off",
-- and is now last_error, "why this account's last poll failed" — a
-- protected, suspended or renamed handle, shown under its stack.

drop table if exists public.network_webhooks;

alter table public.network_profiles
  drop column if exists monitor_id,
  drop column if exists monitor_status;

alter table public.network_profiles
  rename column monitor_error to last_error;

-- Every row is a poll now. The column stays because it is cheap, and a
-- second ingest path (a background refresh worker) would want it again.
alter table public.network_tweets
  alter column source set default 'poll';
