-- Day 7: a draft that's been posted needs to remember what/when, and the
-- resulting X post id so the UI can link out to it. drafts.status already
-- had a free-text 'draft | sent | discarded' comment with no CHECK
-- constraint enforcing it — today's code uses 'posted' as a new value for
-- that same free-text column, no ALTER needed for the status column itself.

alter table public.drafts
  add column posted_at timestamptz,
  add column posted_text text,
  add column posted_x_tweet_id text;
