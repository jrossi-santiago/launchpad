-- The Feed's Reload button writes a reply per card.
--
-- Reload pulls the newest posts for every watched account and has Haiku
-- read each one, so the reply on a card is about that post specifically
-- rather than a template that fits anything. That reply is worth keeping:
-- generating it costs a model call, the card can sit in the Feed for days,
-- and re-polling the same post must not throw the reply away.
--
-- suggested_reply_at is what makes staleness visible — a reply written
-- against a post's first hour reads differently once the thread has moved
-- on — and is what lets a Reload skip cards that already have one instead
-- of paying for them again.
alter table public.network_tweets
  add column if not exists suggested_reply text,
  add column if not exists suggested_reply_at timestamptz;
