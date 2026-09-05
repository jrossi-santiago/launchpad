-- Which of the four comment types a written comment is.
--
-- The app writes comments in four shapes and nothing else: an operator
-- add-on (a change and the number it moved), a receipts story (something
-- that happened to you, with the figure), a respectful counterpoint (the
-- scope it holds in, then the one it does not) and a sharp question. The
-- type is chosen before the comment is written and the text is checked
-- against the shape it promised, so storing it is not decoration — it is
-- the reason this comment reads the way it does, and it is what makes
-- "which type actually earns replies" answerable later.
--
-- Text rather than an enum: the four are defined in
-- lib/anthropic/commentTypes.ts, where the rules that enforce them live,
-- and a Postgres type would be a second place to keep in sync. Null is
-- ordinary — every comment written before this column existed, every
-- decline, and every @grok draft, which is its own shape.
alter table public.network_tweets
  add column if not exists reply_type text;

alter table public.drafts
  add column if not exists draft_type text;
