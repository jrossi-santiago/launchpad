-- What the model made of a post, and whether it could reply at all.
--
-- Replies used to be mandatory: every swept card got one, so a post the
-- model did not follow got a confident reply about nothing. It now says
-- what it thinks the post is about before it writes, names what it was
-- not given, and may decline — and both halves of that are worth keeping.
--
-- reply_about is the diagnostic. Reading what the model thought a post
-- meant is the only way to tell a comprehension problem (it misread plain
-- text) from a context problem (the post turned on a link or image it was
-- never shown), and those have different fixes.
--
-- reply_unclear is why a card has no reply. A card with neither a reply
-- nor this is one that has never been swept; a card with this and no
-- reply was read and declined, which is a different thing and reads
-- differently in the Feed.
alter table public.network_tweets
  add column if not exists reply_about text,
  add column if not exists reply_unclear text;
