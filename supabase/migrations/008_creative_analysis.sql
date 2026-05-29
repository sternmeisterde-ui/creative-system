create table if not exists public.creative_analysis (
  id          uuid primary key default gen_random_uuid(),
  ad_name     text not null unique,
  folder      text,
  mime        text,
  format      text,
  flow        text,
  persona     text,
  hook        text,
  body        text,
  angle       text,
  confidence  integer,
  notes       text,
  created_at  timestamptz default now()
);
