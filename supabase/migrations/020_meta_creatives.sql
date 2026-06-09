-- ============================================================
-- Migration 020: ассеты креативов из Meta (для Gemini-разбора)
--
-- meta/sync тянет только метрики. Чтобы Gemini мог разобрать содержание крео,
-- нужны сами ассеты (видео/картинка) по каждому объявлению. Этот стор наполняет
-- роут /api/meta/creatives из Graph API (creative{thumbnail_url,image_url,video_id}).
-- video source резолвится позже, на этапе Gemini-разбора (по video_id), чтобы не
-- делать тяжёлый per-video запрос на каждый ингест.
-- Грань = ad_id (один актуальный ассет на объявление); привязка к Gemini/отчёту по ad_name.
-- ============================================================

create table if not exists meta_creatives (
  ad_id         text primary key,
  ad_name       text,
  flow          text,
  object_type   text,            -- VIDEO | SHARE | PHOTO | POST_DELETED ...
  thumbnail_url text,
  image_url     text,
  video_id      text,
  asset_url     text,            -- что подавать Gemini по умолчанию (image_url|thumbnail_url); видео — source резолвится по video_id
  fetched_at    timestamptz default now()
);

create index if not exists idx_meta_creatives_ad_name on meta_creatives (lower(btrim(ad_name)));

alter table meta_creatives enable row level security;
create policy "allow all" on meta_creatives for all using (true) with check (true);
