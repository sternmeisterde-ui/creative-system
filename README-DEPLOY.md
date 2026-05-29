# Creative System — self-host deployment guide

Этот документ — пошаговая инструкция как развернуть Creative System под свою компанию.
Стэк: Next.js 16 + Supabase + Anthropic Claude + Meta Marketing API.

---

## TL;DR

1. Fork репозиторий
2. Создай Supabase проект → применить миграции
3. Создай Meta System User token + ad accounts → сохрани в env
4. Создай Anthropic API key → сохрани в env
5. Отредактируй `brief.config.ts` под свой бизнес
6. Deploy на Vercel
7. Открой `app_settings` в Supabase Studio → подкорректируй пороги под свой бизнес

Затем (опционально): подключи Plurio/Elly для лидов, Telegram для алертов, Higgsfield для генерации.

---

## 1. Fork + clone

```bash
git clone https://github.com/YOUR_USERNAME/creative-system.git
cd creative-system
npm install
```

## 2. Supabase

### 2.1 Создать проект
- https://supabase.com → New project
- Регион поближе к Vercel-региону (обычно EU-West / US-East)
- Сохрани `Project URL`, `anon key`, `service_role key` — попадут в `.env.local`

### 2.2 Применить миграции
Установи Supabase CLI: https://supabase.com/docs/guides/cli

```bash
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
```

Это создаст все таблицы (personas/hooks/bodies/angles, briefs, meta_ads, pbi_metrics, app_settings, и т.д.) и view `creative_performance`.

### 2.3 Подкорректировать пороги
По умолчанию в `app_settings` записаны значения SternMeister. Заходи в Supabase Studio → Table Editor → `app_settings` → меняй строку с `id=1`:

| Колонка | Что значит | Дефолт |
|---|---|---|
| `cpl_target` | Цель CPL (€) | 20 |
| `cpql_target` | Цель CPQL (€) | 28 |
| `min_impressions_for_status` | Минимум показов для классификации win/lose | 8000 |
| `low_qual_cr_threshold` | Порог CR Lead→Qual для red flag (%) | 60 |
| `short_lifespan_days` | Порог короткого lifespan (дней) | 7 |
| `low_roas_age_days` | Возраст для проверки ROAS (дней) | 30 |
| `low_roas_min_spend` | Минимум спенда для проверки ROAS (€) | 500 |
| `early_stop_cpl` | Early-stop CPL alert порог (€) | 40 |
| `early_stop_min_impressions` | Early-stop минимум показов | 2000 |
| `dead_zero_spend_floor` | Алерт при N € спенда без единого лида (€) | 50 |
| `fake_winner_alert_spend_floor` | Минимум спенда для алерта по fake_winner (€) | 50 |

## 3. Meta Marketing API

### 3.1 System User token
1. https://business.facebook.com/settings → выбери Business
2. **Users → System Users → Add** → имя на свой вкус (`creative-system` подходит) → role: Admin
3. **System User → Add Assets → Apps** → выбери Meta App (создай если нет) → Full control
4. **System User → Add Assets → Ad Accounts** → добавь все аккаунты, которые будут отдавать данные → permission `Manage ad account`
5. **System User → Generate New Token**:
   - App: тот, что привязал
   - Expiration: **Never** ← важно, иначе token истечёт через 60 дней
   - Scopes:
     - ✅ `ads_read`
     - ✅ `ads_management`
     - ✅ `business_management`
     - ✅ `read_insights`
6. Скопируй token (показывается ОДИН РАЗ) → пойдёт в `META_ACCESS_TOKEN`

### 3.2 Ad Account IDs
В Business Manager → Ad Accounts → копируй ID (формат `act_NNNNNNNNNNN`). По одному на каждый flow (com / gov / ...). См. `brief.config.ts → flows`.

## 4. Anthropic Claude

https://console.anthropic.com → Settings → API Keys → Create Key

Сохрани в `ANTHROPIC_API_KEY`. Используется только server-side, никогда не светится клиенту.

## 5. brief.config.ts

Это сердце системы — описание бизнеса и креативного фреймворка. Открой файл и поменяй:

```typescript
business: {
  name: "TwoiBrand",                 // ← твоё короткое имя
  product: "Что мы продаём",         // ← 1-2 предложения
  language: "ru",                    // ← язык контента
  audience: "Описание ЦА",
}
```

```typescript
ai_context: `
  ДЛИННОЕ ОПИСАНИЕ для Claude. Что за бизнес, какая модель монетизации,
  кто покупатели, как устроена воронка. Это ВАЖНО — попадает во все AI промпты.
  Чем точнее опишешь — тем релевантнее советы.
`,
```

```typescript
flows: [
  // По одному элементу на каждый разрез аналитики (Meta-аккаунт)
  {
    code: "com",                      // короткий код, используется в имени объявления
    label: "Коммерческий",            // UI-лейбл
    description: "Платят сами",
    meta_account_env: "META_AD_ACCOUNT_ID_COM",  // имя env-переменной с ID
  },
  // ... добавь свои
],
```

```typescript
creative_matrix: {
  params: [
    // Можно убрать или поменять буквы. Каждый параметр — это разрез матрицы.
    { key: "persona", letter: "P", label: "Персона", color: "#48B8D0" },
    { key: "hook",    letter: "H", label: "Хук",     color: "#C490D1" },
    // ...
  ],
  formats: ["UGC", "STATIC", "ANIMATION"],   // твои форматы креативов
  name_pattern_template: "P{n}-H{n}-B{n}-A{n}-FORMAT-FLOW",
},
```

## 6. .env.local + Vercel

```bash
cp .env.example .env.local
# Отредактируй .env.local с реальными значениями
```

Локальный запуск:
```bash
npm run dev
# http://localhost:3000
```

Deploy на Vercel:
```bash
npm i -g vercel
vercel link
# Перенеси все env vars в Vercel:
for k in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY META_ACCESS_TOKEN META_AD_ACCOUNT_ID_COM META_AD_ACCOUNT_ID_GOV PLURIO_API_KEY PLURIO_PROJECT_ID TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  echo "Adding $k..."
  read -r v < <(grep "^$k=" .env.local | cut -d= -f2-)
  printf '%s' "$v" | vercel env add "$k" production
done
vercel --prod
```

## 7. Первый запуск

После деплоя:

1. Открой `/database` → создай 3-5 личин, хуков, боди, энглов (или сгенерируй через AI в `/library`)
2. Открой `/scenarios` → напиши базовые сценарии для каждого параметра
3. Открой `/admin` → добавь правила адаптации для AI генерации брифов
4. Запусти `POST /api/meta/sync` → подтянет данные из Meta за последние 30 дней
5. (Опционально) Запусти `POST /api/pbi/elly-sync` → подтянет лиды из Plurio
6. Открой `/analytics` → должна появиться картинка по объявлениям

---

## Опциональные интеграции

### Plurio/Elly (аналитика лидов)

Без Plurio: `meta_ads` есть, `pbi_metrics` пустой → CPL/CPQL = null, fake_winner detection не работает.

Альтернативы:
- Положи лиды в `pbi_metrics` вручную (через CSV / SQL upsert)
- Сделай свою интеграцию, копируя `/api/pbi/elly-sync` под другую BI-систему
- Используй `/api/pbi/upload` для ручного CSV-импорта

### Telegram

Полностью опционально. Если `TELEGRAM_BOT_TOKEN` пустой — все алерты записываются в `creative_alerts` но в Telegram не уходят.

### Higgsfield / ElevenLabs / Creatomate

Нужны только если хочешь генерировать видео/статику прямо в системе. Если используешь свои инструменты — оставь пустыми, страница `/creatives` будет работать в read-only режиме.

### Gemini

Используется в `/analyze` для vision-анализа референсов. Опционально.

---

## Что НЕ настраивается через brief.config.ts (пока)

- i18n UI (вся админка пока на русском — можно правильно настроить через locale файлы позже)
- Multi-tenant (одна установка = одна компания)
- Custom alert types (новые типы алертов нужно добавлять кодом)
- Cron schedules (Vercel Cron Jobs настраиваются через `vercel.json`)

Если что-то не работает — открой issue в репозитории либо напиши автору.
