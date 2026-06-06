#!/usr/bin/env node
/**
 * scripts/map-creatives.mjs — AI-маппинг непромаппленных креативов по КОНТЕНТУ.
 *
 * Зачем: ~194 крео в meta_ads без кодов P/H/B/A в ad_name_mapping → не видны анализу.
 * Имя кодов не несёт, поэтому маппим по медиа: тянем креатив из Meta (видео/картинка),
 * скармливаем Gemini вместе с таксономией библиотеки → коды + confidence.
 *
 * Запись: high/medium (и все 4 кода валидны) → upsert в ad_name_mapping (note = AI(conf): reasoning).
 *         low/ошибка/невалидные коды → в review-отчёт /tmp/map-creatives-review.json, в БД НЕ пишем.
 *
 * Запуск:
 *   node scripts/map-creatives.mjs --limit 2 --dry   # тест, ничего не пишет
 *   node scripts/map-creatives.mjs --limit 5          # маленькая партия live
 *   node scripts/map-creatives.mjs                    # все непромаппленные (резюмируемо)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => process.stdout.write(m + "\n");

// ── env ──────────────────────────────────────────────────────────────────────
for (const line of (existsSync(path.join(ROOT, ".env.local")) ? readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n") : [])) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_TOKEN   = process.env.META_ACCESS_TOKEN;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !META_TOKEN || !GEMINI_KEY) {
  log("✗ Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN, GEMINI_API_KEY в .env.local");
  process.exit(1);
}

const GRAPH       = "https://graph.facebook.com/v21.0";
const GEMINI_GEN  = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const FILES_API   = "https://generativelanguage.googleapis.com/upload/v1beta/files";

const argv = process.argv.slice(2);
const DRY   = argv.includes("--dry");
const LIMIT = (() => { const i = argv.indexOf("--limit"); return i >= 0 ? parseInt(argv[i + 1], 10) : Infinity; })();

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── библиотека (таксономия + множества валидных кодов) ─────────────────────────
async function loadLibrary() {
  const pick = async (table, cols) => (await sb.from(table).select(cols).order("code")).data ?? [];
  const [personas, hooks, bodies, angles] = await Promise.all([
    pick("personas", "code,name,short,description"),
    pick("hooks", "code,name,description"),
    pick("bodies", "code,name,description"),
    pick("angles", "code,name,description"),
  ]);
  const fmt = (rows) => rows.filter(r => r.code).map(r => `  ${r.code} — ${r.name}${r.short ? ` (${r.short})` : ""}`).join("\n");
  const taxonomy =
    `ПЕРСОНЫ (persona_code):\n${fmt(personas)}\n\n` +
    `ХУКИ (hook_code):\n${fmt(hooks)}\n\n` +
    `БОДИ (body_code):\n${fmt(bodies)}\n\n` +
    `ЭНГЛЫ (angle_code):\n${fmt(angles)}`;
  const setOf = (rows) => new Set(rows.map(r => r.code).filter(Boolean));
  return { taxonomy, sets: { persona: setOf(personas), hook: setOf(hooks), body: setOf(bodies), angle: setOf(angles) } };
}

// ── worklist: имена без полного кода в ad_name_mapping ─────────────────────────
// битые имена (UTM-мусор) — не крео: начинаются с | или содержат fmt=/cr=/fun=/utm
const isJunkName = (n) => !n || /^\s*\|/.test(n) || /(^|\|)\s*(fmt|cr|fun|utm)\s*=/i.test(n);

async function getWorklist() {
  const { data: perf } = await sb.from("creative_performance")
    .select("ad_name, ad_id, flow, spend").order("spend", { ascending: false }).limit(5000);
  const { data: maps } = await sb.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, note").limit(5000);
  // пропускаем уже обработанные: полностью закодированные ИЛИ уже размеченные AI (note=AI…)
  const done = new Set((maps ?? [])
    .filter(m => (m.persona_code && m.hook_code && m.body_code && m.angle_code) || (m.note || "").startsWith("AI"))
    .map(m => (m.ad_name || "").trim().toLowerCase()));
  const seen = new Set();
  const work = [];
  for (const r of perf ?? []) {
    const key = (r.ad_name || "").trim().toLowerCase();
    if (!key || done.has(key) || seen.has(key) || isJunkName(r.ad_name)) continue;
    seen.add(key);
    work.push(r);
  }
  return work;
}

// ── Meta: достать медиа + текст по ad_id ───────────────────────────────────────
async function fetchCreative(adId) {
  const fields = "name,creative{thumbnail_url,image_url,object_type,object_story_spec{video_data{video_id,message,title},link_data{message,name,description,image_hash}}}";
  const res = await fetch(`${GRAPH}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${META_TOKEN}`);
  if (!res.ok) throw new Error(`Meta ad ${res.status}`);
  const d = await res.json();
  const cr = d.creative ?? {};
  const oss = cr.object_story_spec ?? {};
  const vd = oss.video_data ?? {};
  const ld = oss.link_data ?? {};
  const adText = [vd.title, vd.message, ld.name, ld.description, ld.message].filter(Boolean).join(" | ").slice(0, 600);

  let mediaUrl = null, mime = "image/jpeg";
  if (vd.video_id) {
    const vres = await fetch(`${GRAPH}/${vd.video_id}?fields=source&access_token=${META_TOKEN}`);
    if (vres.ok) { const v = await vres.json(); if (v.source) { mediaUrl = v.source; mime = "video/mp4"; } }
  }
  if (!mediaUrl) mediaUrl = cr.image_url || cr.thumbnail_url || null;  // fallback на кадр
  return { mediaUrl, mime, adText, isVideo: mime === "video/mp4" };
}

// ── Gemini Files API (паттерн из app/api/gemini/analyze) ───────────────────────
async function uploadToGemini(buffer, mime, name) {
  const init = await fetch(`${FILES_API}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  const uploadUrl = init.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini upload init failed");
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Type": mime },
    body: buffer,
  });
  if (!up.ok) throw new Error(`Gemini upload ${up.status}`);
  const info = (await up.json()).file;
  if (!info?.uri || !info?.name) throw new Error("Gemini no uri");
  for (let i = 0; i < 30; i++) {                       // poll до ACTIVE (видео обрабатывается)
    const st = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${info.name}?key=${GEMINI_KEY}`)).json();
    if (st.state === "ACTIVE") return info.uri;
    if (st.state === "FAILED") throw new Error("Gemini file FAILED");
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Gemini file not ACTIVE in time");
}

// ── Gemini: классификация по таксономии → строгий JSON ─────────────────────────
async function classify(fileUri, mime, adText, taxonomy) {
  const prompt = `Ты классифицируешь рекламный креатив SternMeister по внутренней библиотеке параметров.
Курс «Бухгалтер в Германии» (обучение на русском, сертификат DEKRA).

ТАКСОНОМИЯ (выбирай ТОЛЬКО из этих кодов):
${taxonomy}

ТЕКСТ ОБЪЯВЛЕНИЯ (из Meta): ${adText || "—"}

Посмотри видео/изображение и текст. Определи, какие persona/hook/body/angle РЕАЛЬНО использует креатив.
Правила:
- Выбирай код ТОЛЬКО если он действительно подходит. Если не уверен — ставь null для этого поля.
- format: одно из UGC / STATIC / ANIMATION / HUMAN / MIXED (по визуалу).
- confidence: "high" — всё ясно и однозначно; "medium" — основное понятно, есть допущения; "low" — догадки/не таксономический креатив (квиз, гайд и т.п.).
- reasoning: МАКСИМУМ одно короткое предложение (до 20 слов).

Верни СТРОГО JSON-объект: {"persona_code","hook_code","body_code","angle_code","format","confidence","reasoning"}.`;

  const res = await fetch(`${GEMINI_GEN}?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { file_data: { mime_type: mime, file_uri: fileUri } }] }],
      // thinkingBudget:0 — 2.5-flash иначе тратит maxOutputTokens на «мышление» и обрывает JSON
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini gen ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try { return JSON.parse(txt); }
  catch { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(`bad JSON: ${txt.slice(0, 120)}`); }
}

// ── upsert в ad_name_mapping (без unique-constraint: ищем по ad_name) ──────────
async function upsertMapping(row) {
  const { data: existing } = await sb.from("ad_name_mapping").select("id").eq("ad_name", row.ad_name).maybeSingle();
  if (existing) await sb.from("ad_name_mapping").update(row).eq("id", existing.id);
  else await sb.from("ad_name_mapping").insert(row);
}

// ── main ───────────────────────────────────────────────────────────────────────
const lib = await loadLibrary();
const work = (await getWorklist()).slice(0, LIMIT);
log(`map-creatives | ${DRY ? "DRY (без записи)" : "LIVE"} | к обработке: ${work.length}`);

const review = [];
let written = 0, lowConf = 0, errors = 0;

for (let i = 0; i < work.length; i++) {
  const { ad_name, ad_id, flow } = work[i];
  const tag = `[${i + 1}/${work.length}] ${ad_name.slice(0, 36)}`;
  try {
    const { mediaUrl, mime, adText, isVideo } = await fetchCreative(ad_id);
    if (!mediaUrl) throw new Error("нет медиа (ни видео, ни картинки)");
    const buf = Buffer.from(await (await fetch(mediaUrl)).arrayBuffer());
    const fileUri = await uploadToGemini(buf, mime, ad_name);
    const r = await classify(fileUri, mime, adText, lib.taxonomy);

    // валидация кодов против библиотеки
    const valid = (set, code) => (code && lib.sets[set].has(code)) ? code : null;
    const codes = {
      persona_code: valid("persona", r.persona_code),
      hook_code:    valid("hook", r.hook_code),
      body_code:    valid("body", r.body_code),
      angle_code:   valid("angle", r.angle_code),
    };
    // пишем частичные: достаточно ≥1 валидного кода при high/medium (помогает bivariate/params)
    const anyValid = codes.persona_code || codes.hook_code || codes.body_code || codes.angle_code;
    const conf = (r.confidence || "low").toLowerCase();
    const accept = !!anyValid && (conf === "high" || conf === "medium");

    const rec = { ad_name, ad_id, flow, media: isVideo ? "video" : "image", ...codes, format: r.format ?? null, confidence: conf, accepted: accept, reasoning: r.reasoning ?? "" };

    if (accept && !DRY) {
      await upsertMapping({
        ad_name, ...codes,
        format: (r.format ?? "").toLowerCase() || null,
        flow: (flow ?? "").toLowerCase() || null,
        note: `AI(${conf}): ${(r.reasoning ?? "").slice(0, 200)}`,
      });
    }
    if (accept) written++; else { lowConf++; review.push(rec); }
    log(`${tag} → ${codes.persona_code || "?"}·${codes.hook_code || "?"}·${codes.body_code || "?"}·${codes.angle_code || "?"} (${conf}) ${accept ? (DRY ? "✓dry" : "✓ записан") : "→ ревью"}`);
  } catch (e) {
    errors++;
    const msg = e instanceof Error ? e.message : String(e);
    review.push({ ad_name, ad_id, error: msg });
    log(`${tag} ✗ ${msg}`);
  }
  await new Promise(r => setTimeout(r, 500)); // мягкий rate-limit
}

const reportPath = "/tmp/map-creatives-review.json";
writeFileSync(reportPath, JSON.stringify(review, null, 2));
log(`\nГотово: записано ${written}, на ревью ${lowConf}, ошибок ${errors}.`);
log(`Ревью-отчёт (low/ошибки): ${reportPath}`);
process.exit(0);
