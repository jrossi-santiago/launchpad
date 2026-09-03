-- Launchpad Day 3: single-tweet lookup adds url/metrics and dedupes fetches.
alter table public.tweets
  add column url text,
  add column metrics jsonb not null default '{}'::jsonb;

alter table public.tweets
  add constraint tweets_user_x_tweet_id_unique unique (user_id, x_tweet_id);
