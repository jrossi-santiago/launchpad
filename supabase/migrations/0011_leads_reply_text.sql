-- Follow-up to Day 10: the dashboard only showed that a lead replied or
-- retweeted, not what they actually said, and only a truncated snippet of
-- the post they engaged with. Store the reply's own text (repliers only —
-- a retweet carries no text of its own) so /leads can show "their reply"
-- and "why they were pulled" with real detail instead of just a badge.

alter table public.leads add column reply_text text;
comment on column public.leads.reply_text is 'For source = replied: the text of the lead''s own reply. Null for retweeted leads.';
