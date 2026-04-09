-- ============================================================
-- Creative System — Initial Schema
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── ENUM types ───────────────────────────────────────────────
create type ad_format as enum ('ugc', 'static', 'animation', 'human', 'mixed');
create type winner_status as enum ('winner', 'loser', 'unknown', 'testing');
create type creative_source as enum ('internal', 'competitor');
create type session_status as enum ('draft', 'scenarios', 'generating', 'done');
create type rule_category as enum ('adaptation', 'hook', 'body', 'angle', 'persona', 'general');
create type ad_flow as enum ('com', 'gov');
create type alert_type as enum ('cpl_spike', 'ctr_drop', 'pack_dying', 'winner_found', 'loser_detected');
create type concept_status as enum ('pending', 'approved', 'rejected');
create type brief_status as enum ('pending', 'approved', 'needs_revision');

-- ============================================================
-- LIBRARY — параметры
-- ============================================================

create table personas (
  id          uuid primary key default uuid_generate_v4(),
  code        text unique,                    -- P1, P2, P3 ...
  flow        ad_flow not null default 'com', -- com / gov
  name        text not null,
  short       text,
  description text,
  point_a     text,
  point_b     text,
  pains       text[] default '{}',
  triggers    text[] default '{}',
  age         text,
  gender      text,
  color       text default '#48B8D0',
  created_at  timestamptz default now()
);

create table hooks (
  id          uuid primary key default uuid_generate_v4(),
  code        text unique,                    -- H1, H2, H3 ...
  flow        ad_flow not null default 'com',
  name        text not null,
  template    text,
  description text,
  examples    text[] default '{}',
  color       text default '#C490D1',
  created_at  timestamptz default now()
);

create table bodies (
  id          uuid primary key default uuid_generate_v4(),
  code        text unique,                    -- B1, B2, B3 ...
  flow        ad_flow not null default 'com',
  name        text not null,
  template    text,
  description text,
  examples    text[] default '{}',
  color       text default '#6EC8A0',
  created_at  timestamptz default now()
);

create table angles (
  id          uuid primary key default uuid_generate_v4(),
  code        text unique,                    -- A1, A2, A3 ...
  flow        ad_flow not null default 'com',
  name        text not null,
  template    text,
  description text,
  examples    text[] default '{}',
  color       text default '#FF8B5A',
  created_at  timestamptz default now()
);

-- ── Rules ────────────────────────────────────────────────────
create table rules (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  content     text not null,
  category    rule_category not null default 'general',
  active      boolean default true,
  created_at  timestamptz default now()
);

-- ============================================================
-- PRODUCTION — производство
-- ============================================================

create table constructor_sessions (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  flow                ad_flow not null default 'com',
  selected_personas   uuid[] default '{}',
  selected_hooks      uuid[] default '{}',
  selected_bodies     uuid[] default '{}',
  selected_angles     uuid[] default '{}',
  format              ad_format not null default 'ugc',
  total_combinations  int default 0,
  status              session_status default 'draft',
  created_at          timestamptz default now()
);

create table scenarios (
  id          uuid primary key default uuid_generate_v4(),
  param_type  text not null check (param_type in ('persona','hook','body','angle')),
  param_id    uuid not null,
  content     text not null,
  tz          text,
  created_at  timestamptz default now(),
  unique (param_type, param_id)
);

create table briefs (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid references constructor_sessions(id) on delete cascade,
  persona_id    uuid references personas(id),
  hook_id       uuid references hooks(id),
  body_id       uuid references bodies(id),
  angle_id      uuid references angles(id),
  format        ad_format not null default 'ugc',
  adapted_hook  text,
  adapted_body  text,
  adapted_angle text,
  full_brief    text,
  status        brief_status default 'pending',
  revision_note text,
  batch_index   int,                          -- номер батча (0,1,2...)
  created_at    timestamptz default now()
);

-- ============================================================
-- CREATIVES DATABASE — база виннеров/лузеров
-- ============================================================

create table creatives (
  id              uuid primary key default uuid_generate_v4(),
  source          creative_source default 'internal',
  flow            ad_flow not null default 'com',
  persona_id      uuid references personas(id),
  hook_id         uuid references hooks(id),
  body_id         uuid references bodies(id),
  angle_id        uuid references angles(id),
  format          ad_format not null default 'ugc',
  status          winner_status default 'unknown',
  -- Meta link
  meta_ad_id      text,                       -- ID объявления в Meta
  meta_ad_name    text,                       -- нейминг P2-H1-B3-A5-UGC-COM
  -- Competitor info
  competitor_name text,
  raw_text        text,
  description     text,
  notes           text,
  created_at      timestamptz default now()
);

-- ============================================================
-- META API — живые данные (ad level)
-- ============================================================

create table meta_ads (
  id            uuid primary key default uuid_generate_v4(),
  ad_id         text not null,               -- Meta ad ID
  ad_name       text not null,               -- P2-H1-B3-A5-UGC-COM
  adset_id      text,
  adset_name    text,
  campaign_id   text,
  campaign_name text,
  flow          ad_flow,                     -- определяется из ad_name или кабинета
  account_id    text,                        -- act_XXXXXXXXX
  date          date not null,
  spend         numeric(10,2) default 0,
  impressions   int default 0,
  clicks        int default 0,
  reach         int default 0,
  frequency     numeric(6,3) default 0,
  cpm           numeric(10,4) default 0,
  ctr           numeric(8,4) default 0,
  cpc           numeric(10,4) default 0,
  created_at    timestamptz default now(),
  unique (ad_id, date)
);

create index idx_meta_ads_ad_id on meta_ads(ad_id);
create index idx_meta_ads_date on meta_ads(date);
create index idx_meta_ads_flow on meta_ads(flow);

-- ── Sync log ─────────────────────────────────────────────────
create table meta_sync_log (
  id          uuid primary key default uuid_generate_v4(),
  account_id  text not null,
  synced_at   timestamptz default now(),
  date_from   date,
  date_to     date,
  ads_count   int default 0,
  status      text default 'ok',
  error       text
);

-- ============================================================
-- PBI — сквозная аналитика
-- ============================================================

create table pbi_metrics (
  id            uuid primary key default uuid_generate_v4(),
  ad_id         text not null,               -- Meta ad ID (ключ связи)
  ad_name       text,
  date          date not null,
  leads         int default 0,
  qual_leads    int default 0,
  revenue       numeric(12,2) default 0,
  created_at    timestamptz default now(),
  unique (ad_id, date)
);

create index idx_pbi_metrics_ad_id on pbi_metrics(ad_id);
create index idx_pbi_metrics_date on pbi_metrics(date);

-- ── PBI sync log ─────────────────────────────────────────────
create table pbi_sync_log (
  id        uuid primary key default uuid_generate_v4(),
  synced_at timestamptz default now(),
  rows_count int default 0,
  status    text default 'ok',
  error     text
);

-- ============================================================
-- ANALYTICS VIEW — вычисляемые метрики
-- ============================================================

create or replace view creative_performance as
select
  m.ad_id,
  m.ad_name,
  m.flow,
  m.campaign_id,
  m.campaign_name,
  m.adset_id,
  m.adset_name,
  -- аггрегация по всем дням
  sum(m.spend)       as spend,
  sum(m.impressions) as impressions,
  sum(m.clicks)      as clicks,
  avg(m.frequency)   as frequency,
  -- weighted averages
  case when sum(m.impressions) > 0
    then sum(m.spend) / sum(m.impressions) * 1000 end as cpm,
  case when sum(m.impressions) > 0
    then sum(m.clicks)::numeric / sum(m.impressions) * 100 end as ctr,
  case when sum(m.clicks) > 0
    then sum(m.spend) / sum(m.clicks) end as cpc,
  -- PBI данные
  sum(p.leads)       as leads,
  sum(p.qual_leads)  as qual_leads,
  sum(p.revenue)     as revenue,
  -- расчётные метрики
  case when sum(p.leads) > 0
    then sum(m.spend) / sum(p.leads) end as cpl,
  case when sum(p.qual_leads) > 0
    then sum(m.spend) / sum(p.qual_leads) end as cpql,
  case when sum(p.leads) > 0
    then sum(p.qual_leads)::numeric / sum(p.leads) * 100 end as cr_lead_to_qual,
  case when sum(m.clicks) > 0
    then sum(p.leads)::numeric / sum(m.clicks) * 100 end as cr_click_to_lead,
  -- статус виннера (автоматически)
  case
    when sum(m.impressions) >= 8000
      and sum(p.leads) > 0
      and (sum(m.spend) / sum(p.leads)) <= 20
      and sum(p.qual_leads) > 0
      and (sum(m.spend) / sum(p.qual_leads)) <= 28
    then 'winner'
    when sum(m.impressions) >= 8000
      and (
        (sum(p.leads) > 0 and (sum(m.spend) / sum(p.leads)) > 20)
        or (sum(p.qual_leads) > 0 and (sum(m.spend) / sum(p.qual_leads)) > 28)
      )
    then 'loser'
    else 'testing'
  end as auto_status,
  -- план vs факт
  20  as target_cpl,
  28  as target_cpql,
  -- даты
  min(m.date) as first_seen,
  max(m.date) as last_seen
from meta_ads m
left join pbi_metrics p on m.ad_id = p.ad_id and m.date = p.date
group by m.ad_id, m.ad_name, m.flow, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name;

-- ============================================================
-- ALERTS — алерты
-- ============================================================

create table creative_alerts (
  id          uuid primary key default uuid_generate_v4(),
  ad_id       text,
  ad_name     text,
  flow        ad_flow,
  alert_type  alert_type not null,
  message     text not null,
  value       numeric,                        -- текущее значение (например, CPL 32.5)
  threshold   numeric,                        -- пороговое значение (20)
  dismissed   boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- COMPETITOR KNOWLEDGE BASE — база конкурентов
-- ============================================================

create table competitor_concepts (
  id            uuid primary key default uuid_generate_v4(),
  source        text default 'google_sheets',
  concept_type  text,                         -- hook / angle / format / persona
  title         text not null,
  description   text,
  raw_data      jsonb,                         -- оригинальные данные из таблицы
  status        concept_status default 'pending',
  approved_by   text,
  approved_at   timestamptz,
  -- после апрува — ссылка на созданный параметр
  created_param_id   uuid,
  created_param_type text,
  created_at    timestamptz default now()
);

-- ============================================================
-- RLS — Row Level Security (отключаем для MVP, включим позже)
-- ============================================================

alter table personas            enable row level security;
alter table hooks               enable row level security;
alter table bodies              enable row level security;
alter table angles              enable row level security;
alter table rules               enable row level security;
alter table constructor_sessions enable row level security;
alter table scenarios           enable row level security;
alter table briefs              enable row level security;
alter table creatives           enable row level security;
alter table meta_ads            enable row level security;
alter table meta_sync_log       enable row level security;
alter table pbi_metrics         enable row level security;
alter table pbi_sync_log        enable row level security;
alter table creative_alerts     enable row level security;
alter table competitor_concepts enable row level security;

-- Открытый доступ для service_role (сервер) и anon (клиент) — MVP
create policy "allow all" on personas            for all using (true) with check (true);
create policy "allow all" on hooks               for all using (true) with check (true);
create policy "allow all" on bodies              for all using (true) with check (true);
create policy "allow all" on angles              for all using (true) with check (true);
create policy "allow all" on rules               for all using (true) with check (true);
create policy "allow all" on constructor_sessions for all using (true) with check (true);
create policy "allow all" on scenarios           for all using (true) with check (true);
create policy "allow all" on briefs              for all using (true) with check (true);
create policy "allow all" on creatives           for all using (true) with check (true);
create policy "allow all" on meta_ads            for all using (true) with check (true);
create policy "allow all" on meta_sync_log       for all using (true) with check (true);
create policy "allow all" on pbi_metrics         for all using (true) with check (true);
create policy "allow all" on pbi_sync_log        for all using (true) with check (true);
create policy "allow all" on creative_alerts     for all using (true) with check (true);
create policy "allow all" on competitor_concepts for all using (true) with check (true);
