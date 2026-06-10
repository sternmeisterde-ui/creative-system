-- ============================================================
-- Migration 021: привязка Gemini-разбора к объявлению (ad_name)
--
-- Батч-разбор крео (/api/gemini/batch) пишет описание с привязкой к ad_name,
-- чтобы отчёт мог подтянуть описание винеров/fake/лузеров в контекст нарратива.
-- mode='creative_desc' — отличает батч-описания от ручных winner/loser-разборов.
-- ============================================================

alter table gemini_analyses add column if not exists ad_name text;
create index if not exists idx_gemini_analyses_ad_name on gemini_analyses (lower(btrim(ad_name)));
