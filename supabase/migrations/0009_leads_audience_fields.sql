-- Day 9: Pull Audience needs to store the fields GetXAPI returns for a
-- tweet's repliers/retweeters, and to dedupe a person across repeat pulls
-- (and across different source tweets) so a second pull only inserts new
-- people. Reuses the existing tweet_id ("source tweet") and source
-- ("source type") columns from Day 1 rather than duplicating them under
-- new names.

alter table public.leads add column name text;
alter table public.leads add column bio text;
alter table public.leads add column followers_count integer;
alter table public.leads add constraint leads_user_handle_unique unique (user_id, x_username);
comment on column public.leads.source is 'replied | retweeted';
