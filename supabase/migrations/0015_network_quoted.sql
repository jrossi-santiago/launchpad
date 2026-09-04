-- Quote tweets keep their context.
--
-- A quote tweet is the watched account's own original post, so it belongs
-- in a stack — but stored as text alone it reads as a non-sequitur ("this
-- is exactly right"), because the post being quoted is the half that
-- carries the meaning. This holds that half: { handle, name, text, url }.
--
-- jsonb rather than columns: it is display context read as a whole and
-- never filtered on, and GetXAPI does not document the quoted_tweet shape,
-- so the mapper is defensive and the store should not add constraints of
-- its own. Null for the ordinary posts that are not quoting anything.

alter table public.network_tweets
  add column if not exists quoted jsonb;
