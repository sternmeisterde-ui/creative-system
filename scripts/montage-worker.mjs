#!/usr/bin/env node
/**
 * scripts/montage-worker.mjs — локальный ffmpeg-воркер финального монтажа.
 *
 * Зачем: Vercel serverless не умеет ffmpeg, поэтому хорошо смонтированное видео
 * (CFR-нормализация, субтитры в safe-zone, BGM, цвет, анти-фингерпринт, QA)
 * собирается локально по рецептам скилла .claude/skills/video-montage.
 *
 * Поток: auto-advance под MONTAGE_BACKEND=local выставляет группе
 * status='ready_montage'. Этот воркер их забирает, монтирует и проставляет
 * final_url + status='done' (или 'error').
 *
 * Данные берём из Supabase (сцены уже сгенерированы/озвучены/залипсинкены):
 *   - lipsynced_url ?? result_url  — видео сцены
 *   - word_timestamps              — пословные тайминги от ElevenLabs (whisper не нужен)
 *   - audio_duration, dialogue
 *
 * Запуск:
 *   node scripts/montage-worker.mjs --once     # один проход
 *   node scripts/montage-worker.mjs            # polling-цикл (как pack-poll.sh)
 *
 * Конфиг через env (или .env.local): MONTAGE_FONT, MONTAGE_MAX_WORDS,
 *   MONTAGE_BGM_VOLUME, MONTAGE_UNIQUIFY, MONTAGE_POLL_SECONDS.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Синхронная запись в fd 1/2 — флашится сразу даже под launchd (где Node
// блок-буферизует stdout-пайп и обычный console.log «зависает» в буфере).
const log    = (m) => writeSync(1, m + "\n");
const logErr = (m) => writeSync(2, m + "\n");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILL_GEN_OVERLAY = path.join(ROOT, ".claude/skills/video-montage/scripts/gen_text_overlay.py");
const BGM_FILE = path.join(ROOT, "assets/bgm/default.mp3");
const STORAGE_BUCKET = "scene-final";

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  logErr("✗ Нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в окружении или .env.local");
  process.exit(1);
}

const CFG = {
  font:       process.env.MONTAGE_FONT || "impact",          // impact | helvetica
  maxWords:   parseInt(process.env.MONTAGE_MAX_WORDS || "3", 10),
  bgmVolume:  parseFloat(process.env.MONTAGE_BGM_VOLUME || "0.07"),
  uniquify:   process.env.MONTAGE_UNIQUIFY === "1",
  pollMs:     parseInt(process.env.MONTAGE_POLL_SECONDS || "20", 10) * 1000,
  batch:      5,
};

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── shell / ffmpeg ────────────────────────────────────────────────────────────
function run(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"] });
    let out = "", err = "";
    if (capture && child.stdout) child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`));
    });
  });
}
const ff  = (args) => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const ffprobeDuration = async (file) =>
  parseFloat(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { capture: true })) || 0;

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 80)}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// ── субтитры: word_timestamps → чанки по maxWords с абсолютным таймингом ─────────
// scenes: [{ words:[{text,start,end}], offset }] → [{ start, end, text }]
function buildChunks(scenes, maxWords) {
  const cues = [];
  for (const sc of scenes) {
    const words = sc.words || [];
    for (let i = 0; i < words.length; i += maxWords) {
      const chunk = words.slice(i, i + maxWords);
      if (!chunk.length) continue;
      const text = chunk.map(w => w.text).join(" ").trim();
      if (!text) continue;
      cues.push({
        start: sc.offset + chunk[0].start,
        end:   sc.offset + chunk[chunk.length - 1].end,
        text,
      });
    }
  }
  return cues;
}

// ── монтаж одной группы ────────────────────────────────────────────────────────
async function montageGroup(group) {
  const dir = `/tmp/montage/${group.id}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(`${dir}/qa`, { recursive: true });

  const { data: scenes } = await supabase
    .from("creative_generations")
    .select("scene_index, result_url, lipsynced_url, audio_url, dialogue, word_timestamps, audio_duration")
    .eq("scene_group_id", group.id)
    .eq("status", "done")
    .not("result_url", "is", null)
    .order("scene_index", { ascending: true });

  if (!scenes || scenes.length === 0) throw new Error("нет готовых сцен");

  // 1. скачать + CFR-нормализовать каждый клип (скилл §3.1, §6.3)
  const normFiles = [];
  const srtScenes = [];
  let offset = 0;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const src = sc.lipsynced_url || sc.result_url;
    if (!src) continue;
    const raw  = `${dir}/raw_${i}.mp4`;
    const norm = `${dir}/norm_${i}.mp4`;
    await download(src, raw);
    await ff([
      "-i", raw,
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      norm,
    ]);
    normFiles.push(norm);
    srtScenes.push({ words: sc.word_timestamps || [], offset });
    offset += await ffprobeDuration(norm);
  }
  if (normFiles.length === 0) throw new Error("после нормализации нет клипов");

  // 2. concat (скилл §3.4)
  const listFile = `${dir}/concat.txt`;
  await writeFile(listFile, normFiles.map(f => `file '${f}'`).join("\n"));
  const body = `${dir}/body.mp4`;
  await ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", body]);

  // 3. субтитры: word_timestamps → PNG-чанки (Pillow) → overlay с enable-окнами.
  //    libass-независимо — текущий ffmpeg собран без ass/drawtext/subtitles.
  //    PNG в lower_third = safe-zone (скилл §9 overlay-карточки, §12 safe zones).
  const chunks = buildChunks(srtScenes, CFG.maxWords);
  let current = body;
  if (chunks.length > 0) {
    const fontName = CFG.font === "helvetica" ? "Helvetica" : "Impact";
    const inputs = ["-i", body];
    const steps = [];
    let label = "0:v";
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const png = `${dir}/sub_${i}.png`;
      await run("python3", [SKILL_GEN_OVERLAY, "--text", c.text, "--output", png,
        "--font", fontName, "--font-size", "72", "--outline-width", "6",
        "--position", "lower_third", "--max-chars", "18"]);
      // Короткий вход: PNG декодируется только на своё окно (+сдвиг setpts),
      // а не на всю длину видео — иначе N полнокадровых декодеров = минуты на ролик.
      inputs.push("-loop", "1", "-t", (c.end - c.start + 0.3).toFixed(3), "-i", png);
      const sLabel = `s${i}`, out = i === chunks.length - 1 ? "vout" : `v${i}`;
      steps.push(`[${i + 1}:v]setpts=PTS+${c.start.toFixed(2)}/TB[${sLabel}]`);
      steps.push(`[${label}][${sLabel}]overlay=0:0:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})':eof_action=pass[${out}]`);
      label = out;
    }
    const subbed = `${dir}/subbed.mp4`;
    await ff([
      ...inputs,
      "-filter_complex", steps.join(";"),
      "-map", "[vout]", "-map", "0:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "copy", "-movflags", "+faststart", subbed,
    ]);
    current = subbed;
  }

  // 4. BGM (скилл §5.1) — опционально, если есть assets/bgm/default.mp3
  if (existsSync(BGM_FILE)) {
    const mixed = `${dir}/mixed.mp4`;
    await ff([
      "-i", current, "-i", BGM_FILE,
      "-filter_complex",
      `[1:a]aloop=loop=-1:size=2e+09,volume=${CFG.bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", mixed,
    ]);
    current = mixed;
  }

  // 5. анти-фингерпринт (скилл §13, low-distortion — есть вшитые субтитры) — опц.
  if (CFG.uniquify) {
    const uniq = `${dir}/uniq.mp4`;
    await ff([
      "-i", current,
      "-vf", "crop=iw*0.93:ih*0.93,scale=1080:1920:flags=lanczos,hue=h=6,eq=brightness=0.008:contrast=1.015:saturation=1.03,noise=c0s=6:c0f=t+u",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-g", "18", "-bf", "3",
      "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
      "-map_metadata", "-1", "-movflags", "+faststart", uniq,
    ]);
    current = uniq;
  }

  const final = `${dir}/final.mp4`;
  if (current !== final) await ff(["-i", current, "-c", "copy", "-movflags", "+faststart", final]);

  // 6. QA-кадры (скилл §7.1) + проверка длительности
  const dur = await ffprobeDuration(final);
  for (const t of [1, 5, 10, 20, 30].filter(x => x < dur)) {
    await ff(["-ss", String(t), "-i", final, "-vframes", "1", "-q:v", "2", `${dir}/qa/t${t}s.jpg`]).catch(() => {});
  }

  // 7. upload в Storage
  await ensureBucket();
  const buf = await readFile(final);
  const objectPath = `${group.id}/final.mp4`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET).upload(objectPath, buf, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);

  return { publicUrl, sceneCount: normFiles.length, duration: dur, qaDir: `${dir}/qa` };
}

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === STORAGE_BUCKET)) {
    await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  }
}

// ── один проход: claim + montage по всем ready_montage группам ──────────────────
async function tick() {
  const { data: groups, error } = await supabase
    .from("creative_scene_groups")
    .select("id, status, montage_notes")
    .eq("status", "ready_montage")
    .limit(CFG.batch);
  if (error) { logErr(`✗ query: ${error.message}`); return 0; }
  if (!groups || groups.length === 0) return 0;

  let done = 0;
  for (const group of groups) {
    // claim: ready_montage → montaging (атомарно через фильтр статуса)
    const { data: claimed } = await supabase
      .from("creative_scene_groups")
      .update({ status: "montaging", error_message: null })
      .eq("id", group.id).eq("status", "ready_montage")
      .select("id");
    if (!claimed || claimed.length === 0) continue; // забрал другой воркер

    const t0 = Date.now();
    log(`▶ монтаж группы ${group.id} …`);
    try {
      const r = await montageGroup(group);
      await supabase.from("creative_scene_groups")
        .update({ status: "done", final_url: r.publicUrl }).eq("id", group.id);
      log(`✓ ${group.id}: ${r.sceneCount} сцен, ${r.duration.toFixed(1)}с, ${((Date.now() - t0) / 1000).toFixed(0)}с монтажа`);
      log(`  → ${r.publicUrl}`);
      log(`  QA-кадры: ${r.qaDir}`);
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("creative_scene_groups")
        .update({ status: "error", error_message: `montage: ${msg}`.slice(0, 500) }).eq("id", group.id);
      logErr(`✗ ${group.id}: ${msg}`);
    }
  }
  return done;
}

// ── entry ───────────────────────────────────────────────────────────────────
const ONCE = process.argv.includes("--once");
log(`montage-worker | backend=local font=${CFG.font} bgm=${existsSync(BGM_FILE) ? CFG.bgmVolume : "off"} uniquify=${CFG.uniquify ? "on" : "off"} | ${ONCE ? "--once" : `poll ${CFG.pollMs / 1000}s`}`);

if (ONCE) {
  const n = await tick();
  log(n ? `Готово: ${n} групп.` : "Нет групп в статусе ready_montage.");
  process.exit(0);
} else {
  // polling-цикл
  for (;;) {
    try { await tick(); } catch (e) { logErr(`tick error: ${e instanceof Error ? e.message : String(e)}`); }
    await new Promise(r => setTimeout(r, CFG.pollMs));
  }
}
