-- HeatCheck Day 2: Brand Pack interview adds reply templates.
alter table public.brand_packs
  add column reply_templates jsonb not null default '[]'::jsonb;
