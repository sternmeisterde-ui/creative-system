-- ============================================================
-- Migration 002: creative_generations + fix creative_performance view
-- ============================================================

-- ── creative_generations — результаты Higgsfield генерации ───

create table if not exists creative_generations (
  id                uuid primary key default uuid_generate_v4(),
  brief_id          uuid references briefs(id) on delete set null,
  session_id        uuid references constructor_sessions(id) on delete set null,
  format            text not null default 'ugc',
  model             text not null,
  prompt            text,
  is_static         boolean default false,
  status            text not null default 'queued',  -- queued | processing | done | error
  higgsfield_job_id text,
  result_url        text,
  error_message     text,
  revision_note     text,
  created_at        timestamptz default now()
);

create index if not exists idx_creative_generations_brief_id  on creative_generations(brief_id);
create index if not exists idx_creative_generations_status    on creative_generations(status);
create index if not exists idx_creative_generations_created   on creative_generations(created_at desc);

alter table creative_generations enable row level security;
create policy "allow all" on creative_generations for all using (true) with check (true);

-- ============================================================
-- Fix creative_performance view
-- Старый JOIN: ON m.ad_id = p.ad_id AND m.date = p.date — BROKEN
-- PBI хранит ad_id = 'pbi:{ad_name}', а не реальный Meta ad_id.
-- Новый JOIN: по ad_name (нормализованному через LOWER+TRIM).
-- ============================================================

create or replace view creative_performance as
with meta_agg as (
  select
    ad_id,
    ad_name,
    flow,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    sum(spend)       as spend,
    sum(impressions) as impressions,
    sum(clicks)      as clicks,
    avg(frequency)   as frequency,
    min(date)        as first_seen,
    max(date)        as last_seen
  from meta_ads
  group by ad_id, ad_name, flow, campaign_id, campaign_name, adset_id, adset_name
),
pbi_agg as (
  select
    trim(lower(ad_name)) as ad_name_key,
    sum(leads)           as leads,
    sum(qual_leads)      as qual_leads,
    sum(revenue)         as revenue
  from pbi_metrics
  where ad_name is not null
  group by trim(lower(ad_name))
)
select
  m.ad_id,
  m.ad_name,
  m.flow,
  m.campaign_id,
  m.campaign_name,
  m.adset_id,
  m.adset_name,
  m.spend,
  m.impressions,
  m.clicks,
  m.frequency,
  case when m.impressions > 0
    then m.spend / m.impressions * 1000 end                       as cpm,
  case when m.impressions > 0
    then m.clicks::numeric / m.impressions * 100 end              as ctr,
  case when m.clicks > 0
    then m.spend / m.clicks end                                   as cpc,
  coalesce(p.leads, 0)      as leads,
  coalesce(p.qual_leads, 0) as qual_leads,
  coalesce(p.revenue, 0)    as revenue,
  case when coalesce(p.leads, 0) > 0
    then m.spend / p.leads end                                    as cpl,
  case when coalesce(p.qual_leads, 0) > 0
    then m.spend / p.qual_leads end                               as cpql,
  case when coalesce(p.leads, 0) > 0
    then p.qual_leads::numeric / p.leads * 100 end                as cr_lead_to_qual,
  case when m.clicks > 0
    then coalesce(p.leads, 0)::numeric / m.clicks * 100 end      as cr_click_to_lead,
  case
    when m.impressions >= 8000
      and coalesce(p.leads, 0) > 0
      and (m.spend / p.leads) <= 20
      and coalesce(p.qual_leads, 0) > 0
      and (m.spend / p.qual_leads) <= 28
    then 'winner'
    when m.impressions >= 8000
      and (
        (coalesce(p.leads, 0) > 0 and (m.spend / p.leads) > 20)
        or (coalesce(p.qual_leads, 0) > 0 and (m.spend / p.qual_leads) > 28)
      )
    then 'loser'
    else 'testing'
  end                       as auto_status,
  20                        as target_cpl,
  28                        as target_cpql,
  m.first_seen,
  m.last_seen
from meta_agg m
left join pbi_agg p on trim(lower(m.ad_name)) = p.ad_name_key;
