-- ============================================================
-- Migration 027: сводный разбор недели («над чем штормить» на уровне пачки)
--
-- summary       — AI-нарратив (Claude) поверх объективных агрегатов + параметров крео:
--                 какие хуки/энглы/персоны/боди зашли и нет, паттерны, что штормить.
-- summary_note  — командный шторм на уровне недели (правится вручную).
-- Обе в снапшоте недели, чтобы жили вместе с ней.
-- ============================================================

alter table weekly_creative_reports add column if not exists summary      text not null default '';
alter table weekly_creative_reports add column if not exists summary_note text not null default '';
