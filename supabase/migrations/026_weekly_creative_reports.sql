-- ============================================================
-- Migration 026: субъективный анализ крео — понедельные снапшоты
--
-- Каждую неделю команда собирает статистику по всем крео за прошлую неделю
-- (пн–вс) и вешает на каждый субъективную оценку. Раньше это жило в Google
-- Sheets; переносим в систему.
--
-- weekly_creative_reports — замороженный снапшот недели. rows[] хранит метрики
--   per-креатив НА МОМЕНТ сборки (spend/impr/cpm/cpc/ctr/leads/cpl/qual/cpql/
--   hook_rate/hold_rate/status + превью из meta_creatives). Заморозка нужна,
--   потому что окно [week_start, week_end] фиксировано, а лиды доезжают с лагом
--   (цикл сделки 14–30д) — пересчёт на лету исказил бы историческую неделю.
-- weekly_creative_notes — субъективная оценка per-креатив внутри снапшота.
--   note   — финальный текст, который правит человек;
--   ai_note — последний черновик от Gemini (чтобы регенерация не затирала правки).
-- Грань заметки = (report_id, ad_id): один креатив в одной неделе.
-- ============================================================

create table if not exists weekly_creative_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  week_start  date not null,
  week_end    date not null,
  label       text not null default '',           -- «07.07–13.07»
  rows        jsonb not null default '[]'::jsonb   -- WeeklyCreativeRow[]
);

create unique index if not exists uq_weekly_reports_window
  on weekly_creative_reports (week_start, week_end);
create index if not exists idx_weekly_reports_created
  on weekly_creative_reports (created_at desc);

create table if not exists weekly_creative_notes (
  report_id   uuid not null references weekly_creative_reports(id) on delete cascade,
  ad_id       text not null,
  note        text not null default '',   -- человеческая финальная оценка
  ai_note     text not null default '',   -- последний AI-черновик (Gemini)
  updated_at  timestamptz not null default now(),
  primary key (report_id, ad_id)
);

alter table weekly_creative_reports enable row level security;
alter table weekly_creative_notes   enable row level security;
create policy "allow all" on weekly_creative_reports for all using (true) with check (true);
create policy "allow all" on weekly_creative_notes   for all using (true) with check (true);
