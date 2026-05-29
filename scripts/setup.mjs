#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Creative System — интерактивный setup wizard.
// Спрашивает значения, валидирует через API, генерирует .env.local + brief.config.ts.
// Запуск: `npm run setup`  (или прямо: `node scripts/setup.mjs`)
// ─────────────────────────────────────────────────────────────────────────────
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rl = createInterface({ input: stdin, output: stdout });
const ROOT = resolve(import.meta.dirname, "..");

const COLOR = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const c = (col, s) => `${COLOR[col]}${s}${COLOR.reset}`;

async function ask(question, { required = true, mask = false, default: def, validate } = {}) {
  while (true) {
    let prompt = c("cyan", "? ") + question;
    if (def !== undefined) prompt += c("dim", ` (${def})`);
    prompt += c("dim", " > ");
    const raw = await rl.question(prompt);
    const value = raw.trim() || (def ?? "");
    if (!value && required) {
      console.log(c("red", "  → обязательное поле"));
      continue;
    }
    if (validate) {
      const err = await validate(value);
      if (err) {
        console.log(c("red", `  → ${err}`));
        continue;
      }
    }
    if (mask && value) {
      console.log(c("dim", `  → ${value.slice(0, 8)}…${value.slice(-4)} (${value.length} символов)`));
    }
    return value;
  }
}

async function confirm(question, def = true) {
  const ans = await ask(question + (def ? " [Y/n]" : " [y/N]"), { required: false });
  if (!ans) return def;
  return /^y|yes|д|да/i.test(ans);
}

function section(title) {
  console.log("\n" + c("bold", `━━━ ${title} ━━━`));
}

async function validateUrl(s) {
  try { new URL(s); return null; }
  catch { return "невалидный URL"; }
}

// ── Validators ────────────────────────────────────────────────────────────────

async function pingSupabase(url, anonKey) {
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } });
  if (res.status === 401) return "ключ невалидный или URL не от того проекта";
  if (!res.ok && res.status !== 404) return `HTTP ${res.status}`;
  return null;
}

async function pingAnthropic(key) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
  });
  if (res.status === 401) return "ключ невалидный";
  if (!res.ok) {
    const t = await res.text();
    return `HTTP ${res.status}: ${t.slice(0, 200)}`;
  }
  return null;
}

async function pingMetaToken(token) {
  const res = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`);
  const json = await res.json();
  if (json.error) return `${json.error.message}`;
  return null;
}

async function pingMetaAccount(token, accountId) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${accountId}?fields=name,currency,account_status&access_token=${encodeURIComponent(token)}`);
  const json = await res.json();
  if (json.error) return `${json.error.message}`;
  return null;
}

// ── Main flow ────────────────────────────────────────────────────────────────

async function main() {
  console.log(c("bold", "\n🚀 Creative System — установка\n"));
  console.log(c("dim", "Перед стартом подготовь:"));
  console.log(c("dim", "  • Supabase project URL + anon key + service_role key"));
  console.log(c("dim", "  • Anthropic API key (sk-ant-...)"));
  console.log(c("dim", "  • Meta System User token + минимум один ad account ID"));
  console.log(c("dim", "Каждый ключ будет проверен через API сразу при вводе.\n"));

  if (!(await confirm("Готов?", true))) {
    console.log("OK, запусти когда подготовишься.");
    rl.close();
    return;
  }

  // ── 1. Supabase ─────────────────────────────────────────────────────────
  section("1/5 · Supabase");
  console.log(c("dim", "Settings → API в Supabase dashboard"));
  const supaUrl = await ask("Project URL", { validate: validateUrl });
  const supaAnon = await ask("anon public key", { mask: true });
  const supaSvc  = await ask("service_role key", { mask: true });
  console.log(c("dim", "  пингую…"));
  const supaErr = await pingSupabase(supaUrl, supaAnon);
  if (supaErr) {
    console.log(c("red", `  ✗ Supabase: ${supaErr}`));
    process.exit(1);
  }
  console.log(c("green", "  ✓ Supabase отвечает"));

  // ── 2. Anthropic ────────────────────────────────────────────────────────
  section("2/5 · Anthropic");
  console.log(c("dim", "https://console.anthropic.com → API Keys"));
  const anthropic = await ask("ANTHROPIC_API_KEY (sk-ant-...)", {
    mask: true,
    validate: v => v.startsWith("sk-ant-") ? null : "должен начинаться с sk-ant-",
  });
  console.log(c("dim", "  пингую…"));
  const anthErr = await pingAnthropic(anthropic);
  if (anthErr) {
    console.log(c("red", `  ✗ Anthropic: ${anthErr}`));
    process.exit(1);
  }
  console.log(c("green", "  ✓ Anthropic отвечает"));

  // ── 3. Meta ─────────────────────────────────────────────────────────────
  section("3/5 · Meta Marketing API");
  console.log(c("dim", "System User token из Meta Business Settings → Users → System Users"));
  const metaToken = await ask("META_ACCESS_TOKEN (EAA...)", {
    mask: true,
    validate: async v => v.startsWith("EAA") ? await pingMetaToken(v) : "должен начинаться с EAA",
  });
  console.log(c("green", "  ✓ Meta token валиден"));

  // ── 4. Brief — бизнес-контекст ──────────────────────────────────────────
  section("4/5 · Brief: бизнес-контекст");
  const bizName = await ask("Имя компании / продукта (короткое)", { default: "MyCompany" });
  const bizProduct = await ask("Что продаём (1-2 предложения)");
  const bizLang = await ask("Язык контента (ISO 2 буквы)", { default: "ru" });
  const bizAudience = await ask("Кто целевая аудитория");

  console.log(c("dim", "\nТеперь поток(и) лидов. Это разрезы аналитики и Meta-аккаунты."));
  console.log(c("dim", "Минимум 1 поток. Например 'main' если у тебя один сегмент."));
  const flows = [];
  while (true) {
    const i = flows.length + 1;
    const code = await ask(`Flow #${i} — короткий код (latin lowercase, например 'main' / 'com' / 'b2b')`, {
      validate: v => /^[a-z0-9_-]+$/.test(v) ? null : "только латиница/цифры/дефис/подчёркивание",
    });
    const label = await ask(`Flow #${i} — UI-лейбл`, { default: code.toUpperCase() });
    const envName = `META_AD_ACCOUNT_ID_${code.toUpperCase()}`;
    console.log(c("dim", `  ad account ID попадёт в env ${envName}`));
    const accountId = await ask(`Flow #${i} — Ad Account ID (act_NNNN...)`, {
      validate: async v => {
        if (!/^act_\d+$/.test(v)) return "формат: act_NNNNNNNNN";
        return await pingMetaAccount(metaToken, v);
      },
    });
    flows.push({ code, label, envName, accountId });
    if (!(await confirm(`Добавить ещё flow?`, false))) break;
  }

  console.log(c("dim", "\nКонтекст для AI — описание бизнеса, которое попадёт в промпты Claude."));
  console.log(c("dim", "Опиши свободно: модель монетизации, воронку, типичные возражения, особенности аудитории."));
  const aiContext = await ask("AI context (длинный текст, без переносов)");

  const cycleMin = await ask("Цикл сделки — минимум (дней от лида до оплаты)", { default: "7" });
  const cycleMax = await ask("Цикл сделки — максимум (дней)", { default: "30" });

  // ── 5. Запись файлов ────────────────────────────────────────────────────
  section("5/5 · Запись файлов");

  // .env.local
  const envContent = [
    `# Сгенерировано scripts/setup.mjs ${new Date().toISOString()}`,
    ``,
    `# Supabase`,
    `NEXT_PUBLIC_SUPABASE_URL=${supaUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${supaAnon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${supaSvc}`,
    ``,
    `# Anthropic`,
    `ANTHROPIC_API_KEY=${anthropic}`,
    ``,
    `# Meta`,
    `META_ACCESS_TOKEN=${metaToken}`,
    ...flows.map(f => `${f.envName}=${f.accountId}`),
    ``,
    `# Опциональные интеграции — заполни если используешь`,
    `PLURIO_API_KEY=`,
    `PLURIO_PROJECT_ID=`,
    `TELEGRAM_BOT_TOKEN=`,
    `TELEGRAM_CHAT_ID=`,
    `HIGGSFIELD_API_KEY_ID=`,
    `HIGGSFIELD_API_KEY_SECRET=`,
    `HIGGSFIELD_API_URL=https://platform.higgsfield.ai`,
    `ELEVENLABS_API_KEY=`,
    `ELEVENLABS_VOICE_ID=`,
    `SYNCSO_API_KEY=`,
    `CREATOMATE_API_KEY=`,
    `GEMINI_API_KEY=`,
    ``,
  ].join("\n");

  const envPath = resolve(ROOT, ".env.local");
  if (existsSync(envPath)) {
    if (!(await confirm(`.env.local уже существует, перезаписать?`, false))) {
      writeFileSync(envPath + ".new", envContent);
      console.log(c("yellow", `  ⚠ записал в .env.local.new — слей вручную`));
    } else {
      writeFileSync(envPath, envContent);
      console.log(c("green", `  ✓ .env.local перезаписан`));
    }
  } else {
    writeFileSync(envPath, envContent);
    console.log(c("green", `  ✓ .env.local создан`));
  }

  // brief.config.ts
  const briefContent = generateBriefConfig({
    name: bizName, product: bizProduct, language: bizLang, audience: bizAudience,
    aiContext, flows, cycleMin: Number(cycleMin), cycleMax: Number(cycleMax),
  });
  const briefPath = resolve(ROOT, "brief.config.ts");
  if (existsSync(briefPath)) {
    const backupPath = briefPath + "." + Date.now() + ".bak";
    writeFileSync(backupPath, readFileSync(briefPath));
    console.log(c("dim", `  бэкап старого brief.config.ts → ${backupPath.split("/").pop()}`));
  }
  writeFileSync(briefPath, briefContent);
  console.log(c("green", `  ✓ brief.config.ts создан`));

  // ── Final summary ───────────────────────────────────────────────────────
  console.log(c("bold", c("green", "\n✅ Конфигурация записана.\n")));
  console.log(c("bold", "Что дальше:"));
  console.log("");
  console.log(c("cyan", "  1. Применить миграции БД:"));
  console.log(c("dim",  "     npm i -g supabase  # если не установлен"));
  console.log(c("dim",  `     supabase link --project-ref ${new URL(supaUrl).hostname.split(".")[0]}`));
  console.log(c("dim",  "     supabase db push"));
  console.log("");
  console.log(c("cyan", "  2. Локальный запуск (проверить что всё работает):"));
  console.log(c("dim",  "     npm run dev"));
  console.log(c("dim",  "     # → открой http://localhost:3000"));
  console.log(c("dim",  "     # → запусти POST /api/meta/sync"));
  console.log(c("dim",  "     # → проверь /analytics что появилась картинка"));
  console.log("");
  console.log(c("cyan", "  3. Deploy на Vercel:"));
  console.log(c("dim",  "     npm i -g vercel  # если не установлен"));
  console.log(c("dim",  "     vercel link"));
  console.log(c("dim",  "     vercel env pull   # синк env переменных"));
  console.log(c("dim",  "     vercel --prod"));
  console.log("");
  console.log(c("dim",  "Опциональные интеграции (Plurio / Telegram / Higgsfield) добавишь позже в .env.local"));
  console.log(c("dim",  "Подкручивание порогов: Supabase Studio → Table Editor → app_settings → правишь строку id=1"));
  console.log("");

  rl.close();
}

// ── Generator ────────────────────────────────────────────────────────────────

function generateBriefConfig({ name, product, language, audience, aiContext, flows, cycleMin, cycleMax }) {
  const flowsTs = flows.map(f => `    {
      code: ${JSON.stringify(f.code)},
      label: ${JSON.stringify(f.label)},
      meta_account_env: ${JSON.stringify(f.envName)},
    }`).join(",\n");

  return `/**
 * BRIEF — сгенерирован setup wizard'ом.
 * Правь любые поля вручную, формат свободный.
 * Числовые пороги KPI/fake_winner живут в БД (app_settings), не здесь.
 */

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
  brand_voice: { tone: string; forbidden_words?: string[]; style_notes?: string };
}

export const brief: BriefConfig = {
  business: {
    name: ${JSON.stringify(name)},
    product: ${JSON.stringify(product)},
    language: ${JSON.stringify(language)},
    audience: ${JSON.stringify(audience)},
  },

  ai_context: ${JSON.stringify(aiContext)},

  flows: [
${flowsTs},
  ],

  funnel: {
    stages: ["lead", "qual_lead", "transaction"],
    cycle_days_min: ${cycleMin},
    cycle_days_max: ${cycleMax},
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
    tone: "Прямой, с примерами. Без воды.",
    forbidden_words: [],
  },
};
`;
}

main().catch(e => {
  console.error(c("red", `\n✗ Ошибка: ${e.message}`));
  rl.close();
  process.exit(1);
});
