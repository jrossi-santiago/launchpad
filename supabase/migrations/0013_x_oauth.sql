-- Official X API (OAuth 2.0) write path, alongside the existing GetXAPI
-- cookie path. Writes — replies, likes, follows, and later scheduled posts
-- — move to the official API so no account is acting through scraped
-- session cookies; reads (Radar, Network, monitor, audience) stay on
-- GetXAPI, where they are far cheaper and carry no suspension risk.
--
-- Existing rows keep working: auth_provider defaults to 'cookie', so a
-- user who connected before this migration keeps posting through GetXAPI
-- until they reconnect via OAuth. Nothing is dropped here — the cookie
-- columns stay so the rollback is a config change, not a migration.

alter table public.x_connections
  add column if not exists auth_provider text not null default 'cookie',
  add column if not exists x_user_id text,
  add column if not exists access_token_encrypted text,
  add column if not exists refresh_token_encrypted text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists scopes text;

alter table public.x_connections
  drop constraint if exists x_connections_auth_provider_check;

alter table public.x_connections
  add constraint x_connections_auth_provider_check
  check (auth_provider in ('cookie', 'oauth2'));

-- x_user_id is the account's own numeric id. The official like and follow
-- endpoints are POST /2/users/{id}/likes and POST /2/users/{id}/following,
-- so without this we could not act as the connected user at all. Resolved
-- once at connect time from GET /2/users/me rather than per action.
comment on column public.x_connections.x_user_id is
  'Numeric X user id of the connected account; required by the official /2/users/{id}/* write endpoints.';

comment on column public.x_connections.token_expires_at is
  'When the OAuth access token expires. Refreshed ahead of this via the stored refresh token.';
