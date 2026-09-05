-- The call to action, kept apart from the comment that carries it.
--
-- Comments are now written short — one point, made and stopped — and the
-- ask that used to be baked into the last sentence is generated as its
-- own line instead. Storing it separately is the point: the card shows
-- the comment alone by default and appends the CTA only when the founder
-- toggles it on, which is a decision they make per post and cannot make
-- if the two arrived already glued together.
--
-- Null is the ordinary case, not an error. Most posts have no honest ask
-- attached to them, and a model that invents one is worse than a model
-- that leaves the column empty.
alter table public.network_tweets
  add column if not exists suggested_cta text;

alter table public.drafts
  add column if not exists draft_cta text;
