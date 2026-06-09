-- ============================================================
-- Migration 019: winner обязан иметь подтверждённый ROAS (с учётом цикла сделки)
--
-- ПРОБЛЕМА: зрелые ады (age 31–370 дн) с revenue €0 / ROAS 0 классифицировались как
-- winner только по CPL/CPQL. У них было время на сделку (цикл 14–30 дн), но выручки нет —
-- это не виннеры, а замаскированный убыток (обе модели проверки это подсветили).
--
-- ПРАВИЛО: зрелый ад (age >= roas_maturity_days, по умолч. 30 = верх цикла сделки) обязан
-- иметь ROAS >= roas_winner_min (по умолч. 1.0), иначе → fake_winner. Молодые ады
-- (age < maturity) НЕ штрафуем: выручка по сделке ещё дозревает, судим только по CPL/CPQL.
--
-- Меняется только ветка winner в auto_status; остальное идентично миграции 017.
-- ============================================================

alter table app_settings add column if not exists roas_maturity_days integer       not null default 30;
alter table app_settings add column if not exists roas_winner_min    numeric(10,2)  not null default 1.0;

drop view if exists creative_performance;
create view creative_performance as
with
settings as (
  select * from app_settings where id = 1
),
meta_agg as (
  select
    trim(lower(ad_name))                                as ad_name_key,
    (array_agg(ad_name        order by spend desc))[1]  as ad_name,
    (array_agg(ad_id          order by spend desc))[1]  as ad_id,
    (array_agg(flow           order by spend desc))[1]  as flow,
    (array_agg(campaign_id    order by spend desc))[1]  as campaign_id,
    (array_agg(campaign_name  order by spend desc))[1]  as campaign_name,
    (array_agg(adset_id       order by spend desc))[1]  as adset_id,
    (array_agg(adset_name     order by spend desc))[1]  as adset_name,
    sum(spend)       as spend,
    sum(impressions) as impressions,
    sum(clicks)      as clicks,
    avg(frequency)   as frequency,
    min(date)        as first_seen,
    max(date)        as last_seen
  from meta_ads
  group by trim(lower(ad_name))
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
    and ad_id like 'elly:%'
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
  left join pbi_agg p on m.ad_name_key = p.ad_name_key
),
flagged as (
  select
    b.*,
    array_remove(array[
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
        -- Зрелый ад (прошёл цикл сделки), но ROAS не подтверждён → замаскированный убыток.
        -- Молодые (age < maturity) не штрафуем — выручка по сделке (14–30 дн) ещё дозревает.
        when f.age_days >= s.roas_maturity_days
          and coalesce(f.roas, 0) < s.roas_winner_min
          then 'fake_winner'
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
