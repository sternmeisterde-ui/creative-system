-- ============================================================
-- Migration 022: мультиплатформенный каркас (Meta + TikTok)
--
-- Добавляет измерение platform к данным объявлений и креативов, чтобы данные TikTok
-- сосуществовали с Meta в тех же таблицах. Существующие строки = 'meta'.
-- TikTok-синк (/api/tiktok/sync) пишет строки с platform='tiktok' (когда задан токен).
-- view creative_performance пока считает как раньше; платформо-специфичную аналитику
-- наращиваем при активации TikTok.
-- ============================================================

alter table meta_ads        add column if not exists platform text not null default 'meta';
alter table meta_creatives  add column if not exists platform text not null default 'meta';

create index if not exists idx_meta_ads_platform       on meta_ads (platform);
create index if not exists idx_meta_creatives_platform on meta_creatives (platform);
