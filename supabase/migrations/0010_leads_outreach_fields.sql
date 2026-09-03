-- Day 10: templated outreach needs somewhere to hold the generated draft
-- per lead, and — for a lead sourced from a reply — the X id of that
-- person's own reply tweet, so "Send as X reply" can target the right
-- conversation (retweeters never get one). leads.status is free text with
-- no CHECK constraint (same as Day 1's drafts.status) — today's code
-- starts writing 'drafted' | 'replied' | 'skipped' into that column
-- instead of Day 1's stale 'exported' | 'contacted' comment.

alter table public.leads add column outreach_draft text;
alter table public.leads add column reply_tweet_id text;
comment on column public.leads.status is 'new | drafted | replied | skipped';
