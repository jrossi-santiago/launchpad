-- Day 7: one connected X account per user, credentials encrypted at rest.
-- Client-side never sees the decrypted auth_token/ct0 — only the resolved
-- handle and a connected/not-connected boolean.

create table public.x_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  x_handle text,                  -- populated only after a successful test-connection call
  auth_token_encrypted text,      -- AES-256-GCM ciphertext (iv+tag+ciphertext), base64
  ct0_encrypted text,             -- same encryption scheme; nullable if GetXAPI turns out
                                   -- not to require ct0 (verify — see Lesson 3)
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.x_connections enable row level security;

create policy "owner full access" on public.x_connections
  for all using (auth.uid() = user_id);
