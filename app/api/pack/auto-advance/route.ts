/**
 * POST /api/pack/auto-advance
 *
 * Самодостаточный оркестратор pipeline для всех in-progress scene_groups.
 * Один вызов = один «тик». Двигает каждую группу по data-driven state machine.
 *
 * Тик состоит из двух фаз:
 *
 *   ФАЗА A (конкурентно, безопасно параллелить):
 *     1) Kling scenes generating  → polling each scene's higgsfield_job_id
 *     2) all scenes have result_url, нет audio → trigger generate-voices (ElevenLabs)
 *     4) все done-сцены имеют lipsynced_url, нет render_id → trigger stitch-scenes (Creatomate)
 *     5) creatomate_render_id set → poll scene-group-status → final_url
 *
 *   ФАЗА B (строго последовательно, ГЛОБАЛЬНАЯ конкурентность lipsync = 1):
 *     3a) опрос in-flight Sync.so lipsync-job'ов → lipsynced_url при COMPLETED
 *     3b) если ни одного job в полёте — сабмит ОДНОЙ следующей сцены
 *
 * Sync.so free-план допускает только 1 конкурентный lipsync-job, поэтому
 * lipsync сериализуется глобально (across всех групп), а не по группе.
 * Все внешние вызовы устойчивы — ошибки не валят тик (никаких throw → 500).
 *
 * Вызывается клиентом по таймеру (/briefs poll каждые 30с) пока есть
 * незавершённые группы. Vercel Cron шлёт GET.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 60;

// Vercel Cron шлёт GET — поддерживаем оба метода.
export async function GET(req: NextRequest) { return POST(req); }

const SYNCSO_API    = "https://api.sync.so/v2";
const SYNCSO_KEY    = process.env.SYNCSO_API_KEY ?? "";
const LIPSYNC_MODEL = "lipsync-2";

// Бэкенд финального монтажа: 'local' — локальный ffmpeg-воркер (scripts/montage-worker.mjs),
// 'creatomate' — облачный рендер (fallback). Дефолт — local.
const MONTAGE_BACKEND = process.env.MONTAGE_BACKEND ?? "local";

interface SceneRow {
  id: string;
  status: string;
  result_url: string | null;
  audio_url: string | null;
  lipsynced_url: string | null;
  lipsync_job_id: string | null;
  higgsfield_job_id: string | null;
  scene_index: number | null;
}

interface GroupRow {
  id: string;
  status: string;
  creatomate_render_id: string | null;
  final_url: string | null;
  voiceover_done: boolean;
}

type SB = ReturnType<typeof createServiceClient>;

// Опрос одного in-flight Sync.so lipsync-job'а. COMPLETED → lipsynced_url;
// FAILED/REJECTED → откат на оригинальное видео (lipsynced_url = result_url),
// чтобы сцена перестала быть кандидатом и stitch мог продолжиться.
async function pollLipsyncJob(supabase: SB, scene: SceneRow): Promise<void> {
  if (!scene.lipsync_job_id) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${SYNCSO_API}/generate/${scene.lipsync_job_id}`, {
        headers: { "x-api-key": SYNCSO_KEY, "Accept": "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return; // транзиент — повторим в следующем тике
    const job = await res.json() as { status: string; outputUrl?: string };

    if (job.status === "COMPLETED" && job.outputUrl) {
      await supabase.from("creative_generations").update({
        lipsynced_url: job.outputUrl,
        status: "done",
      }).eq("id", scene.id);
    } else if (job.status === "FAILED" || job.status === "REJECTED") {
      await supabase.from("creative_generations").update({
        status: "done",
        lipsync_job_id: null,
        lipsynced_url: scene.result_url, // откат на оригинал — stitch использует его
      }).eq("id", scene.id);
    }
  } catch {
    // AbortError / network — молча пропускаем, повторим в следующем тике
  }
}

// Сабмит ОДНОЙ сцены в Sync.so. Устойчиво: при ошибке возвращает false.
async function submitLipsync(supabase: SB, scene: SceneRow): Promise<boolean> {
  if (!scene.result_url || !scene.audio_url) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(`${SYNCSO_API}/generate`, {
        method: "POST",
        headers: { "x-api-key": SYNCSO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: LIPSYNC_MODEL,
          input: [
            { type: "video", url: scene.result_url },
            { type: "audio", url: scene.audio_url },
          ],
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return false; // rate-limit / транзиент — попробуем в следующем тике
    const data = await res.json() as { id?: string };
    if (!data.id) return false;
    await supabase.from("creative_generations").update({
      lipsync_job_id: data.id,
      status: "lipsync",
    }).eq("id", scene.id);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();

  // Все группы, которые ещё не финализированы (нет final_url) и не в ошибке
  const { data: groups, error } = await supabase
    .from("creative_scene_groups")
    .select("id, status, creatomate_render_id, final_url, voiceover_done")
    .neq("status", "error")
    .is("final_url", null)
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!groups || groups.length === 0) {
    return NextResponse.json({ ok: true, idle: true, advanced: 0, totalInProgress: 0 });
  }

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "creative.sternmeister.de";
  const baseUrl = `${proto}://${host}`;

  type StageAction = "polling_kling" | "voicing" | "stitching" | "polling_creatomate" | "ready_montage" | "awaiting_montage" | "skip";
  const advanced: { groupId: string; action: StageAction }[] = [];
  const errors: { groupId: string; error: string }[] = [];

  // ── ФАЗА A: per-group (конкурентно) — kling poll / voice / stitch / creatomate ──
  // Lipsync здесь НЕ трогаем (он сериализуется глобально в фазе B).
  const advance = async (group: GroupRow) => {
    try {
      const { data: scenes } = await supabase
        .from("creative_generations")
        .select("id, status, result_url, audio_url, lipsynced_url, lipsync_job_id, higgsfield_job_id, scene_index")
        .eq("scene_group_id", group.id);

      const sceneList = (scenes ?? []) as SceneRow[];
      if (sceneList.length === 0) return;

      // 1. Polling Kling: пока не все scenes done — апдейтим статусы
      const klingPending = sceneList.filter(s => s.status !== "done" && s.status !== "error" && s.status !== "lipsync" && s.higgsfield_job_id);
      if (klingPending.length > 0) {
        await Promise.all(klingPending.map(s =>
          fetch(`${baseUrl}/api/creative-gen/status?id=${s.id}`, { method: "GET" }).catch(() => null)
        ));
        advanced.push({ groupId: group.id, action: "polling_kling" });
        return;
      }

      // Готовые Kling-сцены (есть result_url). Если ни одной — пропускаем группу.
      const doneScenes = sceneList.filter(s => (s.status === "done" || s.status === "lipsync") && s.result_url);
      if (doneScenes.length === 0) return;

      // 2. Нет audio → voicing (ElevenLabs). Один вызов озвучивает всю группу.
      const needVoicing = doneScenes.some(s => !s.audio_url);
      if (needVoicing && !group.voiceover_done) {
        const r = await fetch(`${baseUrl}/api/creative-gen/generate-voices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneGroupId: group.id }),
        }).catch(() => null);
        if (r && !r.ok) errors.push({ groupId: group.id, error: `voices: HTTP ${r.status}` });
        else advanced.push({ groupId: group.id, action: "voicing" });
        return;
      }

      // (Стадия 3 — lipsync — обрабатывается в фазе B)
      // Если ещё есть сцены без lipsynced_url — ждём фазу B, ничего не делаем.
      const allLipsynced = doneScenes.every(s => s.lipsynced_url);
      if (!allLipsynced) return;

      // 4. Все сцены залипсинкены → передаём на финальный монтаж.
      //    local: помечаем группу ready_montage — её заберёт scripts/montage-worker.mjs.
      //    creatomate (fallback): запускаем облачный stitch.
      if (MONTAGE_BACKEND === "local") {
        // Уже отдано локальному воркеру (ready_montage / montaging) — ничего не делаем.
        if (group.status === "ready_montage" || group.status === "montaging") {
          advanced.push({ groupId: group.id, action: "awaiting_montage" });
          return;
        }
        await supabase.from("creative_scene_groups")
          .update({ status: "ready_montage" }).eq("id", group.id);
        advanced.push({ groupId: group.id, action: "ready_montage" });
        return;
      }

      // 4b. Creatomate: нет render_id → запускаем stitch
      if (!group.creatomate_render_id) {
        const r = await fetch(`${baseUrl}/api/creative-gen/stitch-scenes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneGroupId: group.id }),
        }).catch(() => null);
        if (r && !r.ok) errors.push({ groupId: group.id, error: `stitch: HTTP ${r.status}` });
        else advanced.push({ groupId: group.id, action: "stitching" });
        return;
      }

      // 5. Stitch запущен, ждём Creatomate → poll через scene-group-status
      if (group.creatomate_render_id && !group.final_url) {
        await fetch(`${baseUrl}/api/creative-gen/scene-group-status?id=${group.id}`, { method: "GET" })
          .catch(() => null);
        advanced.push({ groupId: group.id, action: "polling_creatomate" });
        return;
      }
    } catch (e) {
      errors.push({ groupId: group.id, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const CONCURRENCY = 5;
  const groupQueue = [...(groups as GroupRow[])];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (groupQueue.length > 0) {
      const g = groupQueue.shift();
      if (!g) break;
      await advance(g);
    }
  });
  await Promise.all(workers);

  // ── ФАЗА B: lipsync, ГЛОБАЛЬНАЯ конкурентность = 1 ──
  let lipsyncAction: "polled" | "submitted" | "idle" = "idle";
  const groupIds = (groups as GroupRow[]).map(g => g.id);

  // 3a. Опрос всех in-flight lipsync-job'ов (read-only апдейты, можно параллельно)
  const { data: inflight } = await supabase
    .from("creative_generations")
    .select("id, status, result_url, audio_url, lipsynced_url, lipsync_job_id, higgsfield_job_id, scene_index")
    .eq("status", "lipsync")
    .not("lipsync_job_id", "is", null)
    .in("scene_group_id", groupIds);

  const inflightScenes = (inflight ?? []) as SceneRow[];
  if (inflightScenes.length > 0) {
    await Promise.all(inflightScenes.map(s => pollLipsyncJob(supabase, s)));
    lipsyncAction = "polled";
  }

  // 3b. Если после опроса ничего не в полёте — сабмитим РОВНО ОДНУ следующую сцену
  const { count: stillInflight } = await supabase
    .from("creative_generations")
    .select("id", { count: "exact", head: true })
    .eq("status", "lipsync")
    .not("lipsync_job_id", "is", null)
    .in("scene_group_id", groupIds);

  if (!stillInflight) {
    const { data: candidate } = await supabase
      .from("creative_generations")
      .select("id, status, result_url, audio_url, lipsynced_url, lipsync_job_id, higgsfield_job_id, scene_index, scene_group_id")
      .eq("status", "done")
      .not("audio_url", "is", null)
      .is("lipsynced_url", null)
      .in("scene_group_id", groupIds)
      .order("scene_group_id", { ascending: true })
      .order("scene_index", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidate) {
      const ok = await submitLipsync(supabase, candidate as SceneRow);
      if (ok) {
        // отметим группу как lipsync (для UI)
        await supabase.from("creative_scene_groups")
          .update({ status: "lipsync" })
          .eq("id", (candidate as { scene_group_id: string }).scene_group_id);
        lipsyncAction = "submitted";
      }
    }
  }

  return NextResponse.json({
    ok: true,
    totalInProgress: groups.length,
    advanced: advanced.length,
    actions: advanced,
    lipsync: lipsyncAction,
    inflightLipsync: inflightScenes.length,
    errors,
  });
}
