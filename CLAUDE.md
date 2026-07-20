# SternMeister Creative System — Claude Skill

## Бизнес-контекст
Продукт: курс "Бухгалтер в Германии" (SternMeister) — 7 месяцев, сертификат DEKRA, обучение на русском.
Два потока лидов:
- **COM** (`act_2363791534094905`) — коммерческие, платят сами. Проблемный сегмент, CPQL стабильно выше плана.
- **GOV** (`act_721283820441329`) — Jobcenter/Bildungsgutschein, государство платит. Перевыполняют план.

Creative System — внутренний инструмент производства Meta Ads креативов. Цель: сократить цикл от гипотезы до запущенного объявления, автоматизировать генерацию брифов и анализ результатов.

**Деплой**: https://creative.sternmeister.de (Vercel, проект `creative-system`, org `stern-meister`)
**Запуск локально**: `npm run dev` → http://localhost:3000

---

## Стек
- **Frontend**: Next.js 16 App Router, TypeScript, inline styles (без CSS-модулей, без Tailwind в коде)
- **Backend**: Next.js API Routes (`app/api/**/route.ts`)
- **БД**: Supabase (PostgreSQL) — `https://cvfmkbqowaziafghdhqm.supabase.co`
- **AI**: Anthropic SDK — `claude-sonnet-4-6` для классификации/рекомендаций, `claude-opus-4-6` для брифов и сценариев
- **Генерация контента**: Higgsfield API (`platform.higgsfield.ai`), auth: заголовки `hf-api-key` + `hf-secret`
- **Аналитика**: Meta Marketing API v21.0 + Elly (Plurio) по SSE
- **Алерты**: Telegram Bot API
- **Цветовая палитра**: `#E8AA42` (золото), `#6EC8A0` (зелёный), `#D96B6B` (красный), `#48B8D0` (голубой), `#C490D1` (фиолетовый), `#FF8B5A` (оранжевый)
- **Фон приложения**: `#08090D`

---

## Страницы и их назначение

| Путь | Назначение |
|------|-----------|
| `/` | Дашборд — статус системы, метрики, быстрые действия |
| `/library` | Библиотека параметров — CRUD персон, хуков, боди, энглов |
| `/scenarios` | Сценарии — базовые тексты для каждого параметра |
| `/admin` | Правила адаптации для генерации брифов |
| `/builder` | Конструктор сессий — выбор 3×3×3×3 параметров (макс. 81 комбо) |
| `/briefs` | Брифы — генерация через Claude, аппрув, публикация |
| `/creatives` | Готовые крео — статус генерации Higgsfield, управление |
| `/panel` | Live-панель Meta Ads — CPL/CPQL, алерты, статус пакета |
| `/weekly` | **Субъективный анализ крео** — понедельные снапшоты по всем крео + человеческая/AI-оценка |
| `/analytics` | Аналитика — параметры, комбинации, история, **бивариативный анализ** |
| `/mapping` | Маппинг объявлений — ручная привязка имён к кодам параметров |
| `/competitors` | База конкурентов — импорт из Sheets, AI-инсайты |
| `/analyze` | Анализ креативов через Gemini Vision |
| `/pbi` | Загрузка данных PBI (лиды, квал. лиды, выручка) |
| `/database` | Прямой браузер Supabase таблиц |
| `/feedback` | Обратная связь по брифам |

---

## Производственный цикл (10 шагов)

```
1. Библиотека    → добавить персоны / хуки / боди / энглы
2. Сценарии      → написать базовые тексты для каждого параметра
3. Правила       → настроить правила адаптации в /admin
4. Конструктор   → выбрать 3×3×3×3, создать сессию (до 81 комбо)
5. Брифы         → сгенерировать через Claude Opus, аппрувнуть
6. Публикация    → назначить ad names (P1-H2-B3-A4-UGC-COM)
7. Генерация     → создать видео/статику через Higgsfield
8. Запуск        → вручную запустить в Meta Ads Manager
9. Мониторинг    → /panel — CPL/CPQL, алерты в Telegram
10. Анализ       → /analytics бивариативный → новые гипотезы → шаг 4
```

---

## Нейминг объявлений

Формат: `P{n}-H{n}-B{n}-A{n}-FORMAT-FLOW`

Пример: `P2-H1-B3-A5-UGC-COM`

- **P** = Персона, **H** = Хук, **B** = Боди, **A** = Энгл
- **FORMAT**: `UGC`, `STATIC`, `ANIMATION`, `HUMAN`, `MIXED`
- **FLOW**: `COM` (коммерческий), `GOV` (госники)
- **Критерии виннера**: CPL ≤ €20 + CPQL ≤ €28 + ≥8000 показов
- Парсинг/сборка: `lib/naming.ts` → `parseAdName()`, `buildAdName()`
- Маппинг нестандартных имён: таблица `ad_name_mapping`

---

## База данных (Supabase)

### Основные таблицы
| Таблица | Назначение |
|---------|-----------|
| `personas` | Персоны — code(P1), name, color, flow, description, pains, triggers |
| `hooks` | Хуки — code(H1), name, color, flow, template, description, examples |
| `bodies` | Боди — code(B1), name, color, flow, template, description, examples |
| `angles` | Энглы — code(A1), name, color, flow, template, description, examples |
| `constructor_sessions` | Сессии конструктора — selectedPersonas[], selectedHooks[], etc. |
| `scenarios` | Сценарии — upsert по unique(paramType, paramId) |
| `briefs` | Брифы — sessionId, paramIds, adaptedContent, fullBrief, status |
| `creatives` | Готовые крео — personaId, hookId, bodyId, angleId, format, metaAdId |
| `rules` | Правила адаптации для промтов |
| `meta_ads` | Данные Meta API — upsert по unique(adId, date) |
| `pbi_metrics` | Данные PBI — leads, qualLeads, revenue по adId |
| `ad_name_mapping` | Ручной маппинг нестандартных имён объявлений |
| `competitor_concepts` | Концепты конкурентов — source, rawData, status |
| `creative_alerts` | Алерты — alertType, dismissed |
| `creative_generations` | Записи генераций Higgsfield |
| `weekly_creative_reports` | Понедельные снапшоты субъективного анализа — week_start/end, rows[] (замороженные метрики per-крео) |
| `weekly_creative_notes` | Субъективная оценка per-крео в снапшоте — note (человек) + ai_note (Gemini), грань (report_id, ad_id) |

### Ключевые views
- `creative_performance` — объединяет `meta_ads` + `pbi_metrics`, вычисляет CPL, CPQL, `auto_status` (winner/loser/testing/unknown)

### Клиенты Supabase
- `lib/supabase.ts` → `supabase` (anon, клиент) / `createServiceClient()` (service role, сервер)
- На API routes **всегда** использовать `createServiceClient()`

---

## API Routes

### AI
| Роут | Назначение |
|------|-----------|
| `POST /api/ai/generate-briefs` | Генерация брифов через Claude Opus (streaming) |
| `POST /api/ai/generate-scenario` | Генерация сценария для параметра |
| `POST /api/ai/recommend` | Рекомендации параметров |
| `POST /api/ai/analyze-performance` | Анализ результатов через Claude |
| `POST /api/ai/competitor-insights` | AI-инсайты по топ-20 конкурентам (параллельные запросы) |
| `POST /api/ai/competitor-hypothesis` | Гипотезы по одобренным концептам |

### Генерация (Higgsfield)
| Роут | Назначение |
|------|-----------|
| `POST /api/creative-gen/generate` | Одиночная генерация (фото/видео) |
| `GET /api/creative-gen/status` | Поллинг статуса генерации |
| `POST /api/creative-gen/generate-scenes` | Мульти-сцена видео |
| `POST /api/creative-gen/generate-voices` | Войсовер |
| `POST /api/creative-gen/lipsync-scenes` | Lip-sync |
| `POST /api/creative-gen/stitch-scenes` | Склейка сцен |

### Аналитика
| Роут | Назначение |
|------|-----------|
| `GET /api/analytics/params` | Агрегация по кодам параметров |
| `GET /api/analytics/combinations` | Комбинации пар параметров |
| `GET /api/analytics/lineage` | Генеалогия сессий |
| `GET /api/analytics/bivariate` | **Бивариативный анализ** (split + семьи) |
| `GET /api/analytics/pack-health` | Здоровье пакета (доля виннеров) |
| `POST /api/analytics/early-stop` | Рекомендации по остановке |
| `GET/POST /api/analytics/weekly` | Понедельный снапшот: POST берёт spend/показы/клики/hook из meta_ads за окно, **лиды/квал — из Plurio за то же окно** (`syncElly(weekStart,weekEnd)`, т.к. дневной истории лидов в БД нет), join meta_creatives (фильтр по ad_id/имени — не вся таблица), GET листает/отдаёт. `maxDuration=300` |
| `POST /api/analytics/weekly/note` | Сохранение субъективной заметки / генерация AI-разбора (Gemini flash) |

### Meta / Данные
| Роут | Назначение |
|------|-----------|
| `POST /api/meta/sync` | Синхронизация данных из Meta API |
| `POST /api/meta/creatives` | Ингест ассетов крео (thumbnail/image/video_id) для превью и Gemini — обходит com+gov+**KumiSolo2** (`META_AD_ACCOUNT_ID_K2`), с пагинацией |
| `GET /api/meta/video?videoId=` | 302 на свежий CDN-mp4 (`resolveMetaVideoSource`) — для просмотра видео-крео (source временный, резолвим по клику) |
| `POST/GET /api/gemini/params` | Структурный разбор крео на параметры (формат/персона/хук/энгл/боди/чем силён/над чем штормить) через `analyzeCreativeParams`; кеш в `gemini_analyses(creative_params)` по ad_name; GET отдаёт карту для /weekly |
| `POST /api/analytics/weekly/summary` | Сводный разбор недели: агрегаты в коде + Claude синтезирует паттерны по параметрам («над чем штормить» на уровне пачки); generate → summary, note → summary_note |
| `POST /api/meta/pause` | Остановка объявлений через API |
| `POST /api/pbi/upload` | Загрузка данных PBI |
| `POST /api/pbi/elly-sync` | Синхронизация с Elly (Plurio) по SSE |
| `GET /api/pbi/stats` | Статистика PBI |

### Алерты
- `POST /api/alerts/check` — проверка лузеров, отправка в Telegram
- Логика: `lib/alert-check.ts`
- Типы: `cpl_spike`, `pack_dying`, `winner_found`, `loser_detected`
- Активное объявление = спенд ≥ €1 за последний день

---

## Бивариативный анализ (`/analytics` → таб "Бивариативный")

Метод: split-test на наблюдательных данных.
- **X** = бинарный признак (код параметра, format, flow)
- **Y** = blended CPL = SUM(spend)/SUM(leads) по группе
- **Ratio** = CPL(X=1) / CPL(X=0)
- **Вердикт**: `< 0.75` → HELPS · `> 1.33` → HURTS · иначе → NEUTRAL
- Минимум 3 лида в каждой группе, иначе INSUFFICIENT

**Слой 1 — Параметрический split**: роут `GET /api/analytics/bivariate`
**Слой 2 — Семьи (генеалогия)**: группировка по 3 из 4 кодов, 4-й варьируется. Фильтр: спенд ≥ €20 на члена семьи.

---

## Интеграции

### Meta Marketing API
- Версия: v21.0
- COM аккаунт: `act_2363791534094905`
- GOV аккаунт: `act_721283820441329`
- Токен: `process.env.META_ACCESS_TOKEN`

### Higgsfield API
- Base URL: `platform.higgsfield.ai`
- Auth: два заголовка `hf-api-key` + `hf-secret`
- Статика (`static`) → text-to-image (nano-banana-v2 и др.)
- Видео (все остальные) → text-to-video (kling-2.6-pro и др.)
- Модели: `lib/higgsfield-models.ts`

### Финальный монтаж — локальный ffmpeg-воркер
- Бэкенд монтажа выбирается env-флагом `MONTAGE_BACKEND` (`local` по умолчанию | `creatomate` fallback).
- **local**: `auto-advance`, когда все сцены залипсинкены, ставит группе `status='ready_montage'`
  (Creatomate НЕ вызывается). Локальный `scripts/montage-worker.mjs` (Node, на Mac, как `pack-poll.sh`)
  забирает такие группы и собирает видео по рецептам скилла `.claude/skills/video-montage`:
  CFR-нормализация 1080×1920@30 → concat → пословные субтитры из `word_timestamps` → BGM → QA → `final_url`.
- Субтитры — **PNG-overlay** (Pillow `gen_text_overlay.py` + ffmpeg `overlay ... enable`), а НЕ libass:
  homebrew-сборка ffmpeg идёт без libass/drawtext. PNG короткими входами + `setpts`-сдвиг (≈1 мин на ролик).
- Запуск: `npm run montage` (поллинг) или `npm run montage:once`. Финал → Storage bucket `scene-final`.
- Авто-запуск на Mac: LaunchAgent `scripts/launchd/de.sternmeister.montage-worker.plist` (см. `scripts/launchd/README.md`) — крутится фоном, рестартует при падении. Логи: `~/Library/Logs/montage-worker.{out,err}.log`.
- Конфиг env: `MONTAGE_FONT` (impact/helvetica), `MONTAGE_BGM_VOLUME` (нужен `assets/bgm/default.mp3`),
  `MONTAGE_UNIQUIFY` (анти-фингерпринт для репостов), `MONTAGE_MAX_WORDS`, `MONTAGE_POLL_SECONDS`.
- Статусы группы: `… → lipsync → ready_montage → montaging → done | error`.

### Elly (Plurio) — сквозная аналитика
- SSE-подключение через `POST /api/pbi/elly-sync`
- Подтягивает leads, qualLeads, revenue по adId

### Telegram Bot
- Токен: `process.env.TELEGRAM_BOT_TOKEN`
- Chat ID: `process.env.TELEGRAM_CHAT_ID`
- Алерты: лузеры, выгорание пакета, виннеры

### Конкуренты
- Импорт из Google Sheets: `POST /api/competitors/sheets` → `POST /api/competitors/import`
- Автоматизация: n8n + Apify → webhook `POST /api/competitors/import`
- AI-классификация типа концепта при импорте

---

## Ключевые файлы

| Файл | Что там |
|------|---------|
| `lib/types.ts` | Все доменные типы |
| `lib/store.ts` | Data layer — CRUD обёртки над Supabase |
| `lib/naming.ts` | Парсинг/сборка имён объявлений, автоприсвоение кодов |
| `lib/alert-check.ts` | Логика алертов + Telegram |
| `lib/higgsfield-models.ts` | Реестр моделей Higgsfield |
| `lib/supabase.ts` | Supabase клиенты |
| `scripts/montage-worker.mjs` | Локальный ffmpeg-воркер финального монтажа (MONTAGE_BACKEND=local) |
| `.claude/skills/video-montage/` | Скилл монтажа (SKILL.md + gen_subs.py / gen_text_overlay.py) |
| `components/ui.tsx` | Дизайн-система: Card, Button, Badge, Modal, PageHeader и др. |
| `components/Sidebar.tsx` | Навигация |
| `components/AppShell.tsx` | Лейаут |
| `.env.local` | Все секреты (никогда не коммитить) |

---

## Правила кода

- Строгая типизация TypeScript, никаких `any`
- API routes: всегда `createServiceClient()` (service role)
- Инлайн стили везде (не CSS-модули, не Tailwind классы)
- Функции ≤ 50 строк, файлы ≤ 800 строк
- Нет `console.log` в production
- Не добавлять фичи "на будущее", только то что нужно сейчас
- Prefer editing existing files over creating new ones
