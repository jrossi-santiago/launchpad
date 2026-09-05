-- Which sweep wrote a reply.
--
-- The Feed puts this sweep's replies above the ones carried over from an
-- earlier sweep, and until now it guessed at the boundary: the newest
-- suggested_reply_at in the Feed was the anchor, and anything written
-- within ten minutes of it counted as the same sweep. Wide enough to hold
-- thirty replies written four at a time, and wrong the moment you press
-- Reload twice inside ten minutes — a reply reused from the first press
-- sits inside the window and reads as new.
--
-- A sweep now stamps its own id on every card it writes, so "same sweep"
-- is a fact rather than an inference. Reused cards keep the id of the
-- sweep that actually wrote them, which is exactly what makes them sort
-- and label as old.
alter table public.network_tweets
  add column if not exists reply_sweep_id text;
