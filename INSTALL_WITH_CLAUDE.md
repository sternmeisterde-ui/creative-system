# Creative System — установка через Claude Code

> **Привет, пилот!** Этот файл — инструкция для Claude, а не для тебя.
> Открой Claude Code в любой папке, перетащи этот файл (или вставь его содержимое в чат),
> и Claude сам проведёт всю установку, спрашивая ключи по очереди.
>
> На твоей стороне нужно только: **отвечать на вопросы Claude и подтверждать команды.**
>
> Время: ~1 час (плюс 30 мин на сбор ключей в Meta Business Manager).

---

## 🤖 INSTRUCTIONS FOR CLAUDE

You are guiding a non-technical user through installing **Creative System** —
a Next.js + Supabase + Anthropic + Meta Marketing API project for analyzing Meta Ads creatives.

The goal: by the end of this session, the user will have a working production deployment on Vercel.

---

## 📊 SYSTEM CONCEPTS — что именно ставим (используй эти описания когда пилот спрашивает «а что оно делает?»)

### 1. Креативная матрица P × H × B × A

Каждое объявление описывается 4 параметрами:

- **P (Persona)** — кому показываем (кому это объявление обращено)
- **H (Hook)** — крючок, первые 3 секунды / заголовок, что цепляет
- **B (Body)** — тело, основной аргумент / сценарий
- **A (Angle)** — угол подачи, под каким соусом продаём

Имя объявления в Meta кодирует комбинацию: `P2-H1-B3-A5-UGC-COM`.
Это позволяет агрегировать метрики не «по объявлению», а **«по параметру»** — какие персоны/хуки/боди/энглы реально работают.

При 3 вариантах каждого параметра → 3⁴ = 81 комбинация, при 4 — 256.

### 2. Воронка и метрики

```
Impressions → Clicks → Leads → Qual Leads → Transactions / Revenue
   ↓             ↓        ↓           ↓                ↓
  CPM           CTR      CPL        CPQL             ROAS
                         CR Lead → Qual
                                    CR Qual → Transaction
```

- **CPL** = spend / leads (Meta + BI)
- **CPQL** = spend / qual_leads (квалифицированные лиды по бизнес-критериям)
- **CR Lead→Qual** = qual_leads / leads — какой % лидов проходит квалификацию
- **ROAS** = revenue / spend — рекламная окупаемость

### 3. Автоматическая классификация — 4 статуса

Каждое объявление в view `creative_performance` получает `auto_status`:

| Статус | Условие | Цвет |
|---|---|---|
| **winner** 🟢 | прошёл по CPL/CPQL/impressions И нет red flags | зелёный |
| **fake_winner** 🟠 | прошёл по KPI, НО есть ≥1 red flag (см. п.4) | оранжевый |
| **loser** 🔴 | не прошёл CPL или CPQL при ≥ min_impressions | красный |
| **testing** ⚪ | данных пока недостаточно для вердикта | серый |

Пороги — в таблице `app_settings` (можно править из Supabase Studio без передеплоя).
Дефолт: CPL ≤ €20, CPQL ≤ €28, impressions ≥ 8000.

### 4. ⚠️ Fake winners — ключевая фишка системы

Обычная аналитика смотрит CPL — если он зелёный, объявление считается виннером.
**Но это обман.** Объявление может пройти KPI на старте, при этом:
- лиды не идут в работу (низкий CR Lead→Qual)
- не доходят до оплаты (низкий CR Qual→Transaction / ROAS<1)
- креатив выгорает за неделю (короткий жизненный цикл)

Это **fake winners** — выглядят как успех, но реально съедают бюджет в минус.
Система ловит их через **red flags**:

| Red flag | Когда срабатывает | Дефолт |
|---|---|---|
| `low_qual_cr` | CR Lead→Qual < N% при ≥5 лидах | 60% |
| `short_lifespan` | Жил < N дней и сейчас выключен | 7 дней |
| `low_roas_30d` | Возраст ≥ N дней, ROAS<1, spend ≥ €X | 30д / €500 |

Если объявление прошло KPI И хотя бы один флаг сработал → статус `fake_winner`, не `winner`.

В UI: отдельный таб `/analytics → Fake winners` с разбивкой по флагам и топом параметров, сжигающих бюджет.

### 5. Анализ — 3 уровня

#### Уровень 1: По параметрам (`/analytics → Параметры`)

Агрегация: суммируем spend / leads / quals / status counts **по каждому коду** P/H/B/A отдельно.
Для каждого кода:
- blended CPL = sum(spend) / sum(leads)
- winRate = winners / (winners + fake_winners + losers)
- сколько объявлений с этим кодом было winner / fake_winner / loser

→ Видно какие конкретно персоны/хуки/боди/энглы дают лучший CPL и реже становятся fake.

#### Уровень 2: Комбинации (`/analytics → Комбинации`)

То же самое, но по парам: P×H, P×B, P×A, H×B, H×A, B×A.
6 матриц. Каждая ячейка — статистика по конкретной паре кодов.

→ Видно **взаимодействия**: персона P2 хорошо работает с хуком H1, но плохо с H4.

#### Уровень 3: Бивариативный анализ (`/analytics → Бивариативный`) ★

Это **главная аналитическая фича**. Два слоя.

**Слой 1 — параметрический сплит.**
Для каждого кода X (например P2) сравниваем:
- ads с этим кодом: их blended CPL
- ads без этого кода: их blended CPL
- **ratio** = CPL(X=1) / CPL(X=0)

Вердикт:
- `ratio < 0.75` → **HELPS** — этот код снижает CPL → масштабируй
- `ratio > 1.33` → **HURTS** — этот код повышает CPL → избегай
- `0.75 ≤ ratio ≤ 1.33` → **NEUTRAL** — нет значимого эффекта
- лидов < 3 в любой группе → **INSUFFICIENT** — мало данных

Это даёт **причинно-следственные сигналы**, а не просто корреляцию. Если P3 везде даёт HURTS — значит независимо от хука/боди/энгла P3 проседает.

**Слой 2 — Семьи (генеалогия).**
Группируем объявления так: 3 параметра фиксированы, 4-й варьируется.
Например: семья «P2 + H1 + B3, A варьируется» — все объявления с этой персоной, хуком, боди, но разными энглами.
Внутри семьи смотрим: какой энгл дал лучший CPL, какой худший.

→ Чистое сравнение «при прочих равных» — на сколько меняется CPL когда меняешь только ОДИН параметр.

В UI: для каждой семьи показываем best/worst CPL и spread между ними. Топ-30 семей по spread → самые «контрастные» точки тестирования.

### 6. Алерты

Система пишет алерты в таблицу `creative_alerts` + (опционально) шлёт в Telegram:

- **cpl_spike** / `loser_detected` — объявление стало loser
- **fake_winner_detected** — стал fake_winner при spend ≥ €50
- **dead_zero_leads** — сжёг €50+ без единого лида
- **early_stop** — CPL > €40 при impressions ≥ 2000 (кандидат на ранний стоп)
- **pack_dying** — ≥ 2 активных лузера одновременно → пора запускать новый цикл

Auto-dismiss: когда объявление перестаёт быть лузером/fake — алерт автоматически закрывается.

### Operating principles

- **Be concise but explicit.** Each step is one or two messages. No long lectures.
- **Validate before continuing.** After collecting each API key, ping the corresponding API with `curl` to verify it works. Don't proceed to the next step until the current one is green.
- **Use `AskUserQuestion`** when there are 2-4 clear options. Use plain text prompts for free-form input (URLs, keys, etc.).
- **Show your work.** Before running destructive commands (`rm`, `git clone` into existing dir, `vercel --prod`), explain what will happen and confirm.
- **If you get stuck** — surface the exact error to the user and ask. Don't loop silently.
- **Language:** respond in the same language the user uses (likely Russian, but adapt).

### Step-by-step plan

#### Step 0 — Prerequisites check

Run:
```bash
node --version && git --version
```

If `node` < 20 or `git` missing — stop and tell user to install Node 20+ and Git first. Provide download links: https://nodejs.org and https://git-scm.com.

Check for optional CLI tools (don't block on these, just note):
```bash
which supabase vercel 2>&1
```

Note which are missing so we can install them later when needed.

#### Step 1 — Where to install

Ask the user:
> «В какую папку поставим Creative System? (Enter — поставлю в `./creative-system` в текущей директории.)»

If they give a path — use it. Otherwise default to `./creative-system`.

Verify the parent directory exists. If target folder exists and non-empty — ask whether to delete or use different path.

#### Step 2 — Clone repo

Origin repo: **https://github.com/sternmeisterde-ui/creative-system**

Tell the user:
1. Открой https://github.com/sternmeisterde-ui/creative-system в браузере
2. Нажми **Fork** в правом верхнем углу → выбери свой GitHub аккаунт (или организацию)
3. После форка дай мне URL своего форка (формат `https://github.com/ТВОЙ_USER/creative-system.git`)

После того как пилот дал URL своего форка — run:
```bash
git clone <USER_FORK_URL> <target>
cd <target>
npm install
```

If `npm install` errors — surface the full error to user.

#### Step 3 — Supabase

Tell the user to open https://supabase.com/dashboard, click **New project** if not done yet, wait ~2 min for provisioning, then **Settings → API**.

Collect three values via three separate questions:
- Project URL (validate as URL)
- anon public key (long string starting with `eyJ`)
- service_role key (also `eyJ...`, under "Reveal")

**Validate with curl:**
```bash
curl -sw "[HTTP %{http_code}]" "$SUPABASE_URL/rest/v1/" -H "apikey: $ANON_KEY"
```
Expected: HTTP 200 (with empty `{}` body). If 401 — tell user "key invalid for this project" and ask to re-paste.

#### Step 4 — Anthropic API key

Open https://console.anthropic.com → Settings → API Keys → Create Key.
Note: requires at least $5 balance — guide them to Settings → Plans & Billing if needed.

Ask for the key (`sk-ant-api03-...`).

**Validate:**
```bash
curl -sw "[HTTP %{http_code}]" "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}'
```
Expected: HTTP 200 with message content. If 401 — key invalid.

#### Step 5 — Meta System User token

This is the longest step. Walk the user through https://business.facebook.com/settings:

1. **Users → System Users → Add** → name `creative-system` (avoid the word "Api" — Meta filters it), Admin role
2. **System User → Add Assets → Apps** — pick the Meta App (if none, they need to create one in https://developers.facebook.com/apps), Full control
3. **System User → Add Assets → Ad Accounts** — add ALL ad accounts they want to use, "Manage ad account" permission
4. **System User → Generate New Token**:
   - Expiration: **Never** (critical, otherwise token dies in 60 days)
   - Scopes: ✅ `ads_read`, ✅ `ads_management`, ✅ `business_management`, ✅ `read_insights`
5. Copy token (`EAA...`) — shown only once

Ask for the token, validate:
```bash
curl -sw "[HTTP %{http_code}]" "https://graph.facebook.com/v21.0/me?access_token=$TOKEN"
```
Expected: HTTP 200 with JSON containing System User name. If `OAuthException` — common causes: token already expired, wrong scopes, or user changed Meta password.

#### Step 6 — Meta Ad Accounts and flows

Ask: «Сколько у тебя разных потоков рекламы? Поток — это разрез аналитики, обычно один Meta-аккаунт на поток. Если один сегмент — один flow. Если есть B2B + B2C, или коммерческие + государственные — два flow.»

For each flow, collect:
- **code** — short identifier (`main`, `b2b`, `com`, etc., lowercase latin only)
- **label** — UI display name (e.g. "Коммерческий", "B2B")
- **ad_account_id** — format `act_NNNNNNNNNNN` (from Business Settings → Ad Accounts in Meta)

**Validate each account:**
```bash
curl -sw "[HTTP %{http_code}]" "https://graph.facebook.com/v21.0/$ACCOUNT_ID?fields=name,currency,account_status&access_token=$TOKEN"
```
Expected: HTTP 200 with account name and currency. If error — likely account not attached to System User assets.

#### Step 7 — Business brief (context for AI)

Ask the user, one question at a time:

1. «Имя компании / продукта (короткое, для заголовков и логов)»
2. «Что вы продаёте (1-2 предложения)»
3. «Язык контента» — use AskUserQuestion with options: Russian / English / Other (Other → text input)
4. «Целевая аудитория (1 предложение)»
5. «Цикл сделки от лида до оплаты — минимум дней» (default 7)
6. «Цикл сделки — максимум дней» (default 30)
7. «Опиши бизнес для AI: модель монетизации, воронку, типичные возражения, особенности аудитории, бренд-стиль. Это попадёт во все промпты Claude.» (длинный текст, без переносов)
8. «Тон бренда — одной фразой (например 'Прямой, с примерами' или 'Доверительный, экспертный')» (default «Прямой, с примерами»)
9. «Правила транслитерации/произношения для диалогов и voice-over. Это специфические правила про твой бренд — как произносится название, иностранные слова и т.п. Например: 'SternMeister → ШтернМастер', 'DATEV → дАтэв'. Если правил нет — оставь пустым.»
   - Принимай массив строк, по одному правилу на строку. Если пилот пишет «нет» / пустую строку — пропусти.
   - Эти правила автоматически попадают в промпты Claude при генерации сценариев и voice-over.

#### Step 8 — Write .env.local

Use the `Write` tool to create `<target>/.env.local` with:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=<value>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<value>
SUPABASE_SERVICE_ROLE_KEY=<value>

# Anthropic
ANTHROPIC_API_KEY=<value>

# Meta
META_ACCESS_TOKEN=<value>
# One line per flow:
META_AD_ACCOUNT_ID_<FLOW_CODE_UPPER>=<account_id>

# Optional (user fills later)
PLURIO_API_KEY=
PLURIO_PROJECT_ID=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HIGGSFIELD_API_KEY_ID=
HIGGSFIELD_API_KEY_SECRET=
HIGGSFIELD_API_URL=https://platform.higgsfield.ai
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
SYNCSO_API_KEY=
CREATOMATE_API_KEY=
GEMINI_API_KEY=
```

#### Step 9 — Generate brief.config.ts

Use the `Write` tool to create/overwrite `<target>/brief.config.ts` with this structure (filling in values from Step 7):

```typescript
export interface BriefConfig {
  business: { name: string; product: string; language: string; audience: string };
  ai_context: string;
  flows: Array<{ code: string; label: string; description?: string; meta_account_env: string }>;
  funnel: { stages: string[]; cycle_days_min: number; cycle_days_max: number };
  creative_matrix: {
    params: Array<{ key: string; letter: string; label: string; color: string }>;
    formats: string[];
    name_pattern_template: string;
  };
  brand_voice: {
    tone: string;
    forbidden_words?: string[];
    style_notes?: string;
    /** Правила транслитерации/произношения, попадают в промпты сценариев и voice-over */
    dialogue_rules?: string[];
  };
}

export const brief: BriefConfig = {
  business: {
    name: "<bizName>",
    product: "<bizProduct>",
    language: "<bizLang>",
    audience: "<bizAudience>",
  },
  ai_context: `<aiContext>`,
  flows: [
    // One entry per flow from Step 6:
    { code: "<flowCode>", label: "<flowLabel>", meta_account_env: "META_AD_ACCOUNT_ID_<UPPER>" },
  ],
  funnel: {
    stages: ["lead", "qual_lead", "transaction"],
    cycle_days_min: <cycleMin>,
    cycle_days_max: <cycleMax>,
  },
  creative_matrix: {
    params: [
      { key: "persona", letter: "P", label: "Персона", color: "#48B8D0" },
      { key: "hook",    letter: "H", label: "Хук",     color: "#C490D1" },
      { key: "body",    letter: "B", label: "Боди",    color: "#6EC8A0" },
      { key: "angle",   letter: "A", label: "Энгл",    color: "#FF8B5A" },
    ],
    formats: ["UGC", "STATIC", "ANIMATION", "HUMAN", "MIXED"],
    name_pattern_template: "P{n}-H{n}-B{n}-A{n}-FORMAT-FLOW",
  },
  brand_voice: {
    tone: "<bizBrandTone>",
    forbidden_words: [],
    // Если пилот указал правила транслитерации — добавь их сюда массивом:
    dialogue_rules: [
      // "В диалогах писать ШтернМастер, не SternMeister",
      // "DATEV произносится как дАтэв",
    ],
  },
};
```

**Важно**: `dialogue_rules` подхватывается роутами `/api/ai/generate-scenario` и `/api/creative-gen/generate-voices` — они вставляют эти правила прямо в промпты Claude и voice-over генератора. Если у пилота нет специфичных правил произношения — оставь массив пустым (или вообще убери поле).

If language is not `ru` — adapt the `params[*].label` and `brand_voice.tone` to that language. Ask the user how to translate.

#### Step 10 — Verify build

```bash
npx tsc --noEmit
```

If errors — likely the brief.config.ts has bad syntax. Surface to user.

#### Step 11 — Apply Supabase migrations

Check if `supabase` CLI is installed (`which supabase`). If yes:
```bash
# Project ref = subdomain of supabase URL
PROJECT_REF=<extracted>
supabase link --project-ref $PROJECT_REF
supabase db push
```
Warn user: will prompt for the database password they set during project creation.

If CLI not installed — explain alternative:
- Install: `brew install supabase/tap/supabase` (macOS) or follow https://supabase.com/docs/guides/cli
- Or: open Supabase Studio → SQL Editor, paste each file from `supabase/migrations/` (001 through 011) in order.

After migrations applied — verify by curl:
```bash
curl -sw "[HTTP %{http_code}]" "$SUPABASE_URL/rest/v1/app_settings?select=*" -H "apikey: $SVC_KEY" -H "Authorization: Bearer $SVC_KEY"
```
Expected: array with one row containing default thresholds.

#### Step 12 — Local sanity check

```bash
npm run dev
```
Tell user to open http://localhost:3000 in browser. Should see panel with their company name in the top.

Then in another terminal (or by curl):
```bash
curl -X POST http://localhost:3000/api/meta/sync -H "Content-Type: application/json" -d '{}'
```
Expected: `{ "ok": true, "results": [...] }` with count > 0 per flow.

Once verified — kill the dev server.

#### Step 13 — Deploy to Vercel

Check `vercel` CLI: `which vercel`. If missing:
```bash
npm i -g vercel
```

Then:
```bash
vercel login   # opens browser
vercel link    # creates Vercel project — answer questions interactively
```

Push env vars to Vercel production. For each non-empty line in `.env.local`:
```bash
printf '%s' "$VALUE" | vercel env add "$KEY" production
```

Loop bash script:
```bash
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* || -z "$value" ]] && continue
  printf '%s' "$value" | vercel env add "$key" production 2>&1 | tail -1
done < .env.local
```

Then:
```bash
vercel --prod
```

Extract the deployment URL from output.

#### Step 14 — Final verification

```bash
curl -sw "[HTTP %{http_code}]" $DEPLOY_URL
```
Expected: 200 or 302 (302 if auth wall configured — that's OK).

Also run prod Meta sync once:
```bash
curl -X POST $DEPLOY_URL/api/meta/sync -H "Content-Type: application/json" -d '{}'
```

#### Step 15 — Final summary

Print to user (адаптируй формулировки под язык пилота):

```
✅ Установка завершена.

Открой: <DEPLOY_URL>

ПЕРВЫЕ ШАГИ
  1. /database — добавь 2-3 персоны, 2-3 хука, 2-3 боди, 2-3 энгла
     (или сгенерируй через AI в /library)
  2. POST /api/meta/sync — подтянет данные из Meta за последние 30 дней
  3. /analytics — увидишь свои объявления, классифицированные по 4 статусам

КЛЮЧЕВЫЕ ВКЛАДКИ /analytics
  • Параметры — какие коды (P/H/B/A) работают лучше по CPL/CPQL
  • Комбинации — какие пары (P×H, H×B, …) дают лучшие результаты
  • Виннеры — настоящие победители (KPI прошёл + воронка здоровая)
  • Fake winners ⚠ — самое важное: прошли KPI, но имеют red flags
    (низкий CR в квал, короткий жизненный цикл, ROAS<1). Не повторять.
  • Лузеры — спалили бюджет, не прошли KPI
  • Бивариативный — главная аналитическая фича.
      Слой 1: для каждого кода считает ratio = CPL(с ним) / CPL(без него)
              → HELPS / HURTS / NEUTRAL — причинно-следственные сигналы
      Слой 2: «семьи» — фиксирует 3 параметра, варьирует 4-й
              → видно вклад каждого параметра «при прочих равных»
  • История — генеалогия сессий конструктора (какая сессия родила какие виннеры)

ПОДКРУТКА ПОРОГОВ
  Supabase Studio → Table Editor → app_settings → строка id=1
  Можно править: cpl_target, cpql_target, low_qual_cr_threshold,
  short_lifespan_days, low_roas_age_days, low_roas_min_spend, и др.
  Изменения вступают в силу сразу, без передеплоя.

АЛЕРТЫ
  По умолчанию работают: пишутся в creative_alerts.
  Чтобы шли в Telegram — добавь TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID в env.

ОПЦИОНАЛЬНЫЕ ИНТЕГРАЦИИ (можно добавить позже)
  • Plurio/Elly — без неё /analytics показывает только Meta-метрики
    (spend/impressions/CTR), но не CPL/CPQL → fake_winner detection не работает.
    Альтернатива: грузи CSV-лиды напрямую в pbi_metrics через Supabase Studio.
  • Telegram — алерты в чат
  • Higgsfield + ElevenLabs + Creatomate + Sync.so — генерация видео/voice
  • Gemini — vision-анализ креативов конкурентов

Что не получилось / что доделать — пиши автору.
```

Также напомни пилоту что **самая высокоценная вкладка — «Бивариативный»**:
- Слой 1 показывает причинно-следственные сигналы по каждому параметру
- Слой 2 даёт чистое сравнение «при прочих равных» внутри семей

И что **fake_winners**, скорее всего, дадут пилоту самое неожиданное открытие — обычно их обнаруживается в 3-10 раз больше, чем настоящих виннеров.

### Error recovery patterns

- **Validation fails** — re-ask the same value, don't drop to next step
- **`npm install` fails** — show stderr, ask user to check Node version
- **`supabase db push` fails** — most often: wrong DB password or wrong project ref. Ask user to verify.
- **`vercel env add` says "already exists"** — first `vercel env rm $KEY production --yes`, then re-add
- **Build fails on Vercel** — show error tail, often it's a syntax issue in brief.config.ts. Open the file, find the issue.
- **At any point user says "стоп" / "stop" / "wait"** — pause, don't auto-proceed

### One final reminder

You're not just running commands — you're holding the user's hand through a process they've never done before. Be calm, explicit, and helpful. When something works — say it clearly. When something fails — surface the exact problem and propose a fix. Don't summarize multiple steps into one — go through them one at a time.

Good luck.
