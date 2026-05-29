# Creative System — пилотное развёртывание

Привет! Спасибо что согласился протестировать.

Установка устроена так: ты собираешь 4 ключа (Supabase, Anthropic, Meta + один Ad Account), запускаешь
один setup-скрипт, он сам всё проверяет и заполняет. Дальше — одна команда для миграций, одна для деплоя.

Обычно занимает 1-1.5 часа.

---

## Что ты получишь

**Creative System** — инструмент для работы с Meta Ads креативами:
- Тянет данные из Meta Marketing API (spend, impressions, CTR, кампании, adsets)
- Тянет лиды и оплаты (если есть Plurio/Elly — иначе CSV или своя BI)
- Автоматически классифицирует объявления: **winner / fake_winner / loser / testing**
- Ловит **fake winners** — прошли KPI, но имеют скрытые проблемы (низкий CR в воронке, короткий жизненный цикл, ROAS<1)
- Шлёт алерты в Telegram (опционально)
- Помогает собирать креативные матрицы (P×H×B×A) и брифы через Claude
- Анализирует креативы конкурентов через AI vision

После настройки ты увидишь честную картину по объявлениям без «вроде KPI прошёл, но почему-то денег нет».

---

## Что подготовить ДО запуска wizard'а (30-40 мин)

### 1. Установить локально
- **Node.js 20+** — https://nodejs.org
- **Git** — обычно уже стоит, проверь `git --version`
- (Опционально) **Supabase CLI** — `brew install supabase/tap/supabase` (нужен для миграций)
- (Опционально) **Vercel CLI** — поставится во время setup, либо `npm i -g vercel`

### 2. Создать аккаунты (или зайти в существующие)
- **Supabase** — https://supabase.com (free tier хватает)
- **Anthropic** — https://console.anthropic.com (закинь $5 на баланс)
- **Vercel** — https://vercel.com (hobby tier бесплатный)
- **Meta Business Manager** — доступ Admin к Business твоей компании

### 3. Собрать ключи (по очереди, ничего не запускаем — пока копим)

#### Supabase
- https://supabase.com/dashboard → **New project** → запомни пароль БД
- Дождись прогрева (~2 мин)
- **Settings → API** → скопируй три значения в блокнот:
  - Project URL
  - anon public key
  - service_role key

#### Anthropic
- https://console.anthropic.com → **Settings → API Keys → Create Key**
- Скопируй `sk-ant-api03-...` (показывается один раз)
- **Settings → Plans & Billing** → закинь баланс минимум $5

#### Meta System User token
1. https://business.facebook.com/settings → выбери Business
2. **Users → System Users → Add** → имя `creative-system` (БЕЗ слова "Api" — Meta фильтрует), role: Admin
3. **System User → Add Assets → Apps** → твой Meta App, Full control (если App нет — создай в https://developers.facebook.com/apps)
4. **System User → Add Assets → Ad Accounts** → добавь ВСЕ нужные аккаунты, permission: Manage ad account
5. **System User → Generate New Token**:
   - App: тот, что привязал
   - Expiration: **Never** ← обязательно
   - Scopes: ✅ `ads_read` ✅ `ads_management` ✅ `business_management` ✅ `read_insights`
6. Скопируй token (формат `EAA...`) — **показывается один раз**

#### Meta Ad Account ID(s)
- Business Settings → Ad Accounts → ID формата `act_NNNNNNNNNNN`
- Минимум один, скопируй в блокнот. Если у тебя несколько потоков (например коммерческий и B2B) — копируй несколько.

---

## Запуск (10 минут)

### 1. Forky и clone репо
```bash
# 1. Открой https://github.com/sternmeisterde-ui/creative-system
# 2. Нажми "Fork" в правом верхнем углу
# 3. Замени ТВОЙ_USERNAME ниже на свой GitHub username
git clone https://github.com/ТВОЙ_USERNAME/creative-system.git
cd creative-system
npm install
```

### 2. Setup wizard
```bash
npm run setup
```

Скрипт по очереди спросит все ключи, провалидирует каждый через API (если ключ битый — скажет), потом
спросит про твой бизнес (имя, продукт, аудитория, контекст для AI, потоки лидов).

В конце сам напишет `.env.local` и `brief.config.ts`.

### 3. Применить миграции БД
```bash
supabase link --project-ref ТВОЙ_PROJECT_REF
# project_ref — поддомен из Project URL, например 'cvfmkbqowaziafghdhqm'

supabase db push
```

Если нет Supabase CLI — открой Supabase dashboard → SQL Editor, по очереди
выполни содержимое файлов из `supabase/migrations/` (001 → 011).

### 4. Проверить локально
```bash
npm run dev
# открой http://localhost:3000 — должна загрузиться панель с именем твоей компании
```

Прогон первого Meta sync:
```bash
curl -X POST http://localhost:3000/api/meta/sync
# должно вернуть { "ok": true, ... }
```

Открой `/analytics` — увидишь свои объявления.

### 5. Deploy на Vercel
```bash
npm i -g vercel
vercel login
vercel link

# Перенести env-переменные на Vercel (можно по одной или скриптом):
for k in $(grep -E "^[A-Z_]+=" .env.local | cut -d= -f1); do
  v=$(grep "^$k=" .env.local | cut -d= -f2-)
  [ -n "$v" ] && printf '%s' "$v" | vercel env add "$k" production
done

vercel --prod
```

После успешного деплоя получишь публичный URL.

---

## Подкручивание порогов под свой бизнес

Зайди в **Supabase Studio → Table Editor → app_settings** → правь строку `id=1`:

| Поле | Что значит | Дефолт |
|---|---|---|
| `cpl_target` | Целевой CPL (€) | 20 |
| `cpql_target` | Целевой CPQL (€) | 28 |
| `min_impressions_for_status` | Минимум показов для классификации | 8000 |
| `low_qual_cr_threshold` | Lead→Qual CR ниже — red flag (%) | 60 |
| `short_lifespan_days` | Lifespan меньше — red flag (дней) | 7 |
| `low_roas_age_days` | Возраст для проверки ROAS (дней) | 30 |
| `low_roas_min_spend` | Минимум спенда для проверки ROAS (€) | 500 |
| `early_stop_cpl` | CPL выше — early-stop алерт | 40 |
| `dead_zero_spend_floor` | Спенд без лидов выше — алерт (€) | 50 |

Изменения вступают в силу сразу, без передеплоя.

---

## Опциональные интеграции

Все опциональные. Заполни если нужно — допиши в `.env.local` локально и через `vercel env add` на проде, потом `vercel --prod`.

| Интеграция | Зачем | Без неё |
|---|---|---|
| **Plurio/Elly** | Тянуть лиды/qual_leads/revenue из BI | `pbi_metrics` пустой → CPL/CPQL null → fake_winner detection не работает |
| **Telegram** | Алерты в чат | Алерты пишутся в БД, но в чат не идут |
| **Higgsfield + ElevenLabs + Creatomate + Sync.so** | Генерация видео/статики/voice/lipsync | Страница `/creatives` доступна, но генерация не работает |
| **Gemini** | Vision-анализ креативов конкурентов | Страница `/analyze` не работает |

### Альтернатива Plurio
Если у тебя своя BI/CRM — выгрузи лиды в CSV формата `ad_name, leads, qual_leads, spend, revenue` и
залей в `pbi_metrics` через Supabase Studio. Или сделай свой эндпоинт по подобию `app/api/pbi/elly-sync/route.ts`.

### Telegram
1. https://t.me/BotFather → `/newbot` → получишь токен
2. Напиши боту что-нибудь
3. `https://api.telegram.org/botТВОЙ_ТОКЕН/getUpdates` → найди `chat_id`
4. Добавь в `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   ```
5. `vercel env add` каждое, потом `vercel --prod`

---

## Первый прогон

После деплоя:

1. Открой задеплоенный URL
2. **`/database`** → создай 2-3 личин, 2-3 хука, 2-3 боди, 2-3 энгла. Или сгенерируй через AI в `/library`.
3. **`POST /api/meta/sync`** через curl или прямо в браузере (GET тоже работает)
4. **`/analytics`** → должна появиться картинка с табами Параметры / Комбинации / Виннеры / Fake winners / Лузеры
5. **`/panel`** → live-метрики с разбивкой по статусам

---

## Фидбек

После 1-2 недель использования напиши автору:

1. **Что заработало сразу** — что не пришлось чинить
2. **Где застрял** — какие шаги непонятны / сломаны
3. **Чего не хватает** — фичи для твоего бизнеса
4. **Точность classification** — fake_winners совпадают с твоей интуицией?
5. **AI качество** — анализ от Claude в `/analytics` релевантен?
6. **Что бы упростил/убрал**

Можно текстом, можно скрином. Главное — честно.

---

## FAQ

**Q: Setup wizard не запускается, пишет "fetch is not defined"?**
A: У тебя старая Node. Поставь Node 20+ — `node --version` должно показывать v20.x или новее.

**Q: Wizard ругается на Meta token "Error validating access token"?**
A: Чаще всего: 1) забыл сменить System User token на "Never expires", 2) не привязал ad accounts к System User. Перейди в Meta Business Settings → Users → System Users → проверь ассеты.

**Q: Один Meta аккаунт, не два потока?**
A: При запуске setup на вопросе "Добавить ещё flow?" отвечай "n". Один поток, без проблем.

**Q: Сколько это стоит?**
A: Self-host = бесплатно. Платишь только за:
- Anthropic API (~$5-30/мес в зависимости от объёма анализа)
- Supabase (free до 500MB / 50K MAU)
- Vercel (free до 100GB bandwidth)
- Meta API (бесплатно)
- Plurio (если есть — отдельно)

**Q: Что с приватностью?**
A: Все данные в **твоём** Supabase. AI промпты идут в Anthropic — ad-уровневые данные (имя, метрики) попадают туда. Anthropic не тренируется на данных API-клиентов (https://privacy.anthropic.com).

**Q: Можно ли получить английский UI?**
A: Сейчас всё на русском. i18n в v2.

---

Удачи. Если что — пиши.
