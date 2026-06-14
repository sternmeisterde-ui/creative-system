# SternMeister Creative System

Внутренний инструмент производства и анализа рекламных креативов (Meta Ads, далее — мультиплатформа). Next.js 16 (App Router) + Supabase + Anthropic/Gemini/OpenAI + Higgsfield.

## Запуск
```bash
npm install
npm run dev   # http://localhost:3000
```
Секреты — в `.env.local` (не коммитится). Деплой — Vercel (`README-DEPLOY.md`).

## Производственный цикл
`данные (Meta/TikTok + Elly) → маппинг → Gemini-разбор крео → отчёт (+ AI-проверка Gemini/Codex) → гейт → генерация пака → брифы → продакшен (Gemini image / Higgsfield)`. Кнопка «Прогнать цикл» на `/panel`.

## Рекламные платформы (мультиплатформа)
Источники рекламных данных абстрагированы (`lib/platforms.ts`). Статус — `GET /api/platforms`.

| Платформа | Статус | Подключение |
|-----------|--------|-------------|
| **Meta Ads** | ✅ рабочая | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_COM`, `META_AD_ACCOUNT_ID_GOV`. Синк: `POST /api/meta/sync`, креативы: `/api/meta/creatives` |
| **TikTok Ads** | 🟡 каркас | задать `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` → активируется `POST /api/tiktok/sync` |

Данные обеих платформ живут в `meta_ads`/`meta_creatives` с колонкой `platform` (миграция 022). TikTok-синк (`app/api/tiktok/sync`) — каркас под TikTok Business (Marketing) API: без кредов отдаёт 503; при активации сверить точные endpoint/поля с [TikTok docs](https://business-api.tiktok.com/portal/docs).

## Ключевые env
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `META_ACCESS_TOKEN`, `PLURIO_API_KEY`, `HIGGSFIELD_API_KEY_ID/SECRET`, (опц.) `TIKTOK_ACCESS_TOKEN`/`TIKTOK_ADVERTISER_ID`.

## Миграции
`supabase/migrations/*.sql` — применяются вручную в Supabase SQL editor.
