-- ============================================================
-- Migration 013: analysis_reports — снапшоты единого отчёта по массиву креативов
--
-- Цель: страница /report генерирует «результат анализа» массива в двух формах —
--   visual (детерминированные агрегаты: KPI, HELPS/HURTS, семьи, комбо, конкуренты)
--   и narrative (текстовый AI-разбор, один Opus-проход).
-- Каждая генерация сохраняется снапшотом: можно сравнивать массив неделя к неделе,
-- а производство (пак-генератор) позже сможет ссылаться на последний снапшот.
-- ============================================================

create table if not exists analysis_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  flow        text not null default 'all',   -- com | gov | all
  kpi         jsonb not null default '{}'::jsonb,   -- сводка KPI (health, счётчики статусов, blended CPL/CPQL, спенд)
  visual      jsonb not null default '{}'::jsonb,   -- агрегаты для визуала (helps/hurts/families/combos/competitors)
  narrative   text  not null default ''            -- markdown-нарратив от Claude
);

create index if not exists idx_analysis_reports_flow_created
  on analysis_reports (flow, created_at desc);
