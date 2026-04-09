# SternMeister Creative System — Claude Instructions

## Проект
Next.js 16 App Router + TypeScript + Supabase. Система производства Meta Ads креативов для SternMeister (курсы бухгалтерии для русскоязычных иммигрантов в Германии).

## Стек
- **Frontend**: Next.js 16 App Router, TypeScript, inline styles (без CSS-модулей)
- **Backend**: Next.js API Routes (app/api/**/route.ts)
- **БД**: Supabase (PostgreSQL) — все данные только там
- **AI**: Anthropic SDK — claude-sonnet-4-6 для классификации, claude-opus-4-6 для брифов/сценариев
- **Генерация**: Higgsfield API (`platform.higgsfield.ai`), auth: `hf-api-key` + `hf-secret` headers
- **Аналитика**: Meta Marketing API v21.0 через `creative_performance` view

## Ключевые правила

### TypeScript
- Строгая типизация — никаких `any` без крайней необходимости
- Async/await + try-catch для всех асинхронных операций
- Иммутабельность: `{ ...obj, key: value }` вместо `obj.key = value`
- Функции не длиннее 50 строк, файлы не длиннее 800 строк
- Нет `console.log` в production коде

### API Routes
- Всегда использовать `createServiceClient()` на сервере (service role key)
- Публичный `supabase` клиент только на клиенте (anon key)
- Все ошибки логировать, возвращать понятные сообщения
- Не раскрывать внутренние детали ошибок пользователю

### Безопасность
- Никаких секретов в коде — только `process.env.*`
- Валидация входящих данных на API routes
- Не делать `git add .env*` никогда

### Стиль кода
- Писать минимально необходимый код — не добавлять фичи "на будущее"
- Не добавлять docstrings/комментарии к неизменённому коду
- Prefer editing existing files over creating new ones
- Не использовать эмодзи если пользователь не просил

### Нейминг (бизнес-логика)
- Формат: `P{n}·H{n}·B{n}·A{n}·FORMAT·FLOW`
- Форматы: `ugc`, `static`, `animation`, `human`
- Потоки: `com` (коммерческий), `gov` (госники)
- Критерии виннера: CPL ≤ €20, CPQL ≤ €28, 8000+ показов

### Higgsfield API
- Статика (`static` формат) → text-to-image модели (nano-banana и др.)
- Видео (все остальные форматы) → text-to-video модели (kling, veo3.1 и др.)
- Auth: два отдельных хедера `hf-api-key` и `hf-secret`
- Модели и их body в `lib/higgsfield-models.ts`

## Структура БД (основные таблицы)
- `personas`, `hooks`, `bodies`, `angles` — библиотека параметров
- `constructor_sessions` — сессии конструктора
- `briefs` — адаптированные брифы
- `creative_generations` — генерации Higgsfield
- `creative_performance` — view с Meta + PBI данными
- `competitor_concepts` — анализ конкурентов

## Два рекламных аккаунта
- COM: `act_2363791534094905` — коммерческий поток
- GOV: `act_721283820441329` — госники (Bildungsgutschein)
