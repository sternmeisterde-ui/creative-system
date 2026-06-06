-- ============================================================
-- Migration 012: pack_metadata — генератор паков (auto-builder)
--
-- Расширяет constructor_sessions так, чтобы хранить происхождение
-- каждого из 20 креативов пака:
--   • winner_family   — семья от винера, варьируется 1 параметр
--   • winner_mix      — свободная смесь winning P/H/B/A
--   • discovery       — непротестированная комбинация с HELPS-кодами
--   • competitor      — мэппинг одобренного концепта конкурента
--
-- pack_metadata JSONB структура:
-- {
--   "slots": [
--     {
--       "slot_id": 1,
--       "category": "winner_family",
--       "based_on_ad": "P2-H1-B3-A5-UGC-COM",
--       "varied_param": "angle",
--       "codes": { "persona": "P2", "hook": "H1", "body": "B3", "angle": "A7" },
--       "rationale": "Винер P2-H1-B3-A5: меняем angle на A7 (HELPS по бивариату)"
--     },
--     {
--       "slot_id": 17,
--       "category": "competitor",
--       "source_concept_id": "<uuid>",
--       "new_codes_created": ["H8"],
--       "codes": {...},
--       "rationale": "Из концепта 'Boring accounting school' — взяли хук с провокацией"
--     }
--   ],
--   "distribution": {
--     "winner_family": 6, "winner_mix": 5, "discovery": 5, "competitor": 4
--   },
--   "cold_start": false,
--   "format": "video",
--   "flow": "com",
--   "data_snapshot": { "winners": 12, "fake_winners": 18, "losers": 7 }
-- }
-- ============================================================

alter table constructor_sessions
  add column if not exists pack_metadata jsonb,
  add column if not exists pack_size     int default 0,
  add column if not exists generated_at  timestamptz;

-- Индекс для быстрого поиска паков по дате генерации (история)
create index if not exists idx_constructor_sessions_generated_at
  on constructor_sessions (generated_at desc nulls last);

-- Индекс для запроса «паки по потоку» в истории
create index if not exists idx_constructor_sessions_flow_generated
  on constructor_sessions (flow, generated_at desc nulls last);
