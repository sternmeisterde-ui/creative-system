-- ============================================================
-- Migration 018: вердикты проверки отчёта независимыми моделями
--
-- /report после генерации нарратива (Claude Opus) прогоняет 2 независимые проверки —
-- Gemini и Codex/OpenAI — которые аудируют числа и выводы на правдоподобие/противоречия.
-- Результат (overall + per-model вердикты) сохраняется здесь как jsonb.
-- Структура: { overall: 'ok'|'warning'|'fail', checks: [{model,status,confidence,issues[],summary}] }
-- ============================================================

alter table analysis_reports
  add column if not exists verifications jsonb;
