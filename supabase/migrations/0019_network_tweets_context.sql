-- What a post carries besides its words.
--
-- A tweet is a fragment: its link is a bare t.co with no title, its image
-- is invisible to anything reading the text, and either one routinely
-- carries the whole point. A post whose text is "this is wild" plus a
-- screenshot means nothing on its own — and a model asked to reply to it
-- from the text alone will guess, which is what "pretending to know what
-- is going on" sounds like.
--
-- So the inventory is stored with the card: { links, media, media_alt }.
-- Even the bare count is worth having, because "there is an image here
-- you cannot see" turns an invented reply into an honest decline.
--
-- jsonb for the same reason `quoted` is jsonb: the shape comes from an
-- undocumented API, the mapper is defensive, and this is display and
-- prompt context read as a whole, never filtered on.
alter table public.network_tweets
  add column if not exists context jsonb;
