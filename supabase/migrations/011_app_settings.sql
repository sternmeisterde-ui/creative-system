-- ============================================================
-- Migration 011: app_settings — пороги KPI / fake_winner rules в БД
--
-- Цель: вынести числовые пороги из SQL view в редактируемую таблицу.
-- Один раз ставим значения через INSERT (seed), потом меняем через UPDATE
-- без миграций.
--
-- View creative_performance перестраивается так, чтобы читать пороги
-- из app_settings — изменение настроек сразу отражается в auto_status.
-- ============================================================

create table if not exists app_settings (
  id integer primary key default 1,

  -- KPI цели
  cpl_target                  numeric(10,2) not null default 20,
  cpql_target                 numeric(10,2) not null default 28,
  min_impressions_for_status  integer       not null default 8000,

  -- Fake winner — пороги red flags
  low_qual_cr_threshold       numeric(5,2)  not null default 60,
  short_lifespan_days         integer       not null default 7,
  low_roas_age_days           integer       not null default 30,
  low_roas_min_spend          numeric(10,2) not null default 500,

  -- Early-stop алерты
  early_stop_cpl              numeric(10,2) not null default 40,
  early_stop_min_impressions  integer       not null default 2000,
  dead_zero_spend_floor       numeric(10,2) not null default 50,

  -- Fake-winner алерт
  fake_winner_alert_spend_floor numeric(10,2) not null default 50,

  updated_at timestamptz default now(),
  constraint app_settings_singleton check (id = 1)
);

-- seed одной строки (если ещё нет)
insert into app_settings (id) values (1)
on conflict (id) do nothing;

-- ============================================================
-- Пересоздаём view creative_performance — теперь пороги читаются
-- из app_settings через cross join (одна строка → константы).
-- ============================================================

drop view if exists creative_performance;
create view creative_performance as
with
settings as (
  select * from app_settings where id = 1
),
meta_agg as (
  select
    ad_id, ad_name, flow,
    campaign_id, campaign_name, adset_id, adset_name,
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
    trim(lower(ad_name))  as ad_name_key,
    sum(leads)            as leads,
    sum(qual_leads)       as qual_leads,
    sum(revenue)          as revenue,
    sum(transactions)     as transactions
  from pbi_metrics
  where ad_name is not null
  group by trim(lower(ad_name))
),
base as (
  select
    m.ad_id, m.ad_name, m.flow,
    m.campaign_id, m.campaign_name, m.adset_id, m.adset_name,
    m.spend, m.impressions, m.clicks, m.frequency,
    case when m.impressions > 0
      then m.spend / m.impressions * 1000 end                       as cpm,
    case when m.impressions > 0
      then m.clicks::numeric / m.impressions * 100 end              as ctr,
    case when m.clicks > 0
      then m.spend / m.clicks end                                   as cpc,
    coalesce(p.leads,        0) as leads,
    coalesce(p.qual_leads,   0) as qual_leads,
    coalesce(p.revenue,      0) as revenue,
    coalesce(p.transactions, 0) as transactions,
    case when coalesce(p.leads, 0) > 0
      then m.spend / p.leads end                                    as cpl,
    case when coalesce(p.qual_leads, 0) > 0
      then m.spend / p.qual_leads end                               as cpql,
    case when coalesce(p.leads, 0) > 0
      then p.qual_leads::numeric / p.leads * 100 end                as cr_lead_to_qual,
    case when coalesce(p.qual_leads, 0) > 0
      then coalesce(p.transactions, 0)::numeric / p.qual_leads * 100 end as cr_qual_to_txn,
    case when m.spend > 0
      then coalesce(p.revenue, 0) / m.spend end                     as roas,
    case when m.clicks > 0
      then coalesce(p.leads, 0)::numeric / m.clicks * 100 end       as cr_click_to_lead,
    m.first_seen,
    m.last_seen,
    (m.last_seen - m.first_seen + 1)  as lifespan_days,
    (current_date - m.first_seen + 1) as age_days,
    (m.last_seen >= current_date - 1) as is_active
  from meta_agg m
  left join pbi_agg p on trim(lower(m.ad_name)) = p.ad_name_key
),
flagged as (
  select
    b.*,
    array_remove(array[
      case
        when b.leads >= 5
         and b.cr_lead_to_qual is not null
         and b.cr_lead_to_qual < s.low_qual_cr_threshold
        then 'low_qual_cr'
      end,
      case
        when b.lifespan_days < s.short_lifespan_days
         and not b.is_active
        then 'short_lifespan'
      end,
      case
        when b.age_days >= s.low_roas_age_days
         and b.roas is not null
         and b.roas < 1
         and b.spend >= s.low_roas_min_spend
        then 'low_roas_30d'
      end
    ]::text[], null) as risk_signals
  from base b
  cross join settings s
)
select
  f.ad_id, f.ad_name, f.flow,
  f.campaign_id, f.campaign_name, f.adset_id, f.adset_name,
  f.spend, f.impressions, f.clicks, f.frequency,
  f.cpm, f.ctr, f.cpc,
  f.leads, f.qual_leads, f.revenue, f.transactions,
  f.cpl, f.cpql,
  f.cr_lead_to_qual, f.cr_qual_to_txn, f.cr_click_to_lead,
  f.roas,
  f.first_seen, f.last_seen,
  f.lifespan_days, f.age_days, f.is_active,
  f.risk_signals,
  case
    when f.impressions >= s.min_impressions_for_status
      and f.leads > 0
      and f.cpl <= s.cpl_target
      and f.qual_leads > 0
      and f.cpql <= s.cpql_target
    then
      case
        when coalesce(array_length(f.risk_signals, 1), 0) > 0
          then 'fake_winner'
        else 'winner'
      end
    when f.impressions >= s.min_impressions_for_status
      and (
        (f.leads > 0 and f.cpl > s.cpl_target)
        or (f.qual_leads > 0 and f.cpql > s.cpql_target)
      )
    then 'loser'
    else 'testing'
  end as auto_status,
  s.cpl_target  as target_cpl,
  s.cpql_target as target_cpql
from flagged f
cross join settings s;

-- RLS: открываем чтение app_settings всем, запись — только service role
-- (в текущей конфигурации проекта все таблицы открыты, см. 001_initial_schema.sql)
alter table app_settings enable row level security;
drop policy if exists "allow all" on app_settings;
create policy "allow all" on app_settings for all using (true) with check (true);
