-- ============================================================
-- Migration 010: Снижение порога Lead→Qual CR с 71% до 60%
-- ============================================================
-- Контекст: 71% оказался слишком жёстким — пометил 87 fake_winners
-- из 91 кандидата. После калибровки решено снизить до 60%.
-- ============================================================

drop view if exists creative_performance;
create view creative_performance as
with meta_agg as (
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
    *,
    array_remove(array[
      -- low_qual_cr: Lead→Qual CR < 60% при ≥5 лидах (порог снижен с 71%)
      case
        when leads >= 5
         and cr_lead_to_qual is not null
         and cr_lead_to_qual < 60
        then 'low_qual_cr'
      end,
      -- short_lifespan: жил <7 дней и сейчас выключен
      case
        when lifespan_days < 7
         and not is_active
        then 'short_lifespan'
      end,
      -- low_roas_30d: возраст ≥30 дней, ROAS<1, spend≥€500
      case
        when age_days >= 30
         and roas is not null
         and roas < 1
         and spend >= 500
        then 'low_roas_30d'
      end
    ]::text[], null) as risk_signals
  from base
)
select
  ad_id, ad_name, flow,
  campaign_id, campaign_name, adset_id, adset_name,
  spend, impressions, clicks, frequency,
  cpm, ctr, cpc,
  leads, qual_leads, revenue, transactions,
  cpl, cpql,
  cr_lead_to_qual, cr_qual_to_txn, cr_click_to_lead,
  roas,
  first_seen, last_seen,
  lifespan_days, age_days, is_active,
  risk_signals,
  case
    when impressions >= 8000
      and leads > 0
      and cpl <= 20
      and qual_leads > 0
      and cpql <= 28
    then
      case
        when coalesce(array_length(risk_signals, 1), 0) > 0
          then 'fake_winner'
        else 'winner'
      end
    when impressions >= 8000
      and (
        (leads > 0 and cpl > 20)
        or (qual_leads > 0 and cpql > 28)
      )
    then 'loser'
    else 'testing'
  end                       as auto_status,
  20                        as target_cpl,
  28                        as target_cpql
from flagged;
