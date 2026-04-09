import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const HIGGSFIELD_API    = process.env.HIGGSFIELD_API_URL ?? "https://platform.higgsfield.ai";
const HIGGSFIELD_KEY_ID = process.env.HIGGSFIELD_API_KEY_ID!;
const HIGGSFIELD_SECRET = process.env.HIGGSFIELD_API_KEY_SECRET!;

const SYNCSO_API    = "https://api.sync.so/v2";
const SYNCSO_KEY    = process.env.SYNCSO_API_KEY ?? "";
const LIPSYNC_MODEL = "lipsync-2";

const JOB_TIMEOUT_MS        = 15 * 60 * 1000; // 15 min — single Kling job
const SCENE_JOB_TIMEOUT_MS  = 60 * 60 * 1000; // 60 min — scene series (6 jobs queue up)
const LIPSYNC_TIMEOUT_MS    = 30 * 60 * 1000; // 30 min — lipsync per scene
const STUCK_QUEUED_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — queued with no job_id (submit failed)

async function pollAndUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  genId: string,
  createdAt: string,
  isSceneJob: boolean,
) {
  const timeoutMs = isSceneJob ? SCENE_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS;
  const timeoutLabel = isSceneJob ? ">60 мин" : ">15 мин";
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!isNaN(createdMs) && Date.now() - createdMs > timeoutMs) {
    await supabase.from("creative_generations").update({
      status: "error",
      error_message: `Timeout: генерация зависла (${timeoutLabel}). Попробуйте перегенерировать.`,
    }).eq("id", genId);
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000); // 8s timeout per poll
    let res: Response;
    try {
      res = await fetch(`${HIGGSFIELD_API}/requests/${jobId}/status`, {
        headers: { "hf-api-key": HIGGSFIELD_KEY_ID, "hf-secret": HIGGSFIELD_SECRET, "Accept": "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) {
      await supabase.from("creative_generations").update({
        status: "error", error_message: "Job expired on Higgsfield (404)",
      }).eq("id", genId);
      return;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      await supabase.from("creative_generations").update({
        status: "error", error_message: `Higgsfield poll error ${res.status}: ${errBody.slice(0, 200)}`,
      }).eq("id", genId);
      return;
    }
    const job = await res.json() as { status: string; image?: { url: string }; images?: { url: string }[]; video?: { url: string }; videos?: { url: string }[]; error?: string };
    const resultUrl = job.image?.url ?? job.images?.[0]?.url ?? job.video?.url ?? job.videos?.[0]?.url ?? null;
    if (job.status === "completed" && resultUrl) {
      await supabase.from("creative_generations").update({ status: "done", result_url: resultUrl }).eq("id", genId);
    } else if (job.status === "failed") {
      await supabase.from("creative_generations").update({
        status: "error", error_message: job.error ?? "Generation failed on Higgsfield",
      }).eq("id", genId);
    }
  } catch (e) {
    // AbortError (timeout) or network error — silently skip, will retry next cycle
    void e;
  }
}

async function pollLipsync(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  genId: string,
) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://api.sync.so/v2/generate/${jobId}`, {
        headers: { "x-api-key": process.env.SYNCSO_API_KEY ?? "", "Accept": "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return;

    const job = await res.json() as { status: string; outputUrl?: string };

    if (job.status === "COMPLETED" && job.outputUrl) {
      await supabase.from("creative_generations").update({
        lipsynced_url: job.outputUrl,
        status: "done",
      }).eq("id", genId);
    } else if (job.status === "FAILED" || job.status === "REJECTED") {
      // Fall back to original video
      await supabase.from("creative_generations").update({ status: "done", lipsync_job_id: null }).eq("id", genId);
    }
  } catch {
    // silently skip, retry next cycle
  }
}

// GET /api/creatives — все генерации со статусом done/error/processing
export async function GET() {
  const supabase = createServiceClient();

  // Time out scenes stuck in "queued" with no higgsfield_job_id (submit never completed)
  const stuckCutoff = new Date(Date.now() - STUCK_QUEUED_TIMEOUT_MS).toISOString();
  const { data: stuckQueued } = await supabase
    .from("creative_generations")
    .select("id")
    .eq("status", "queued")
    .is("higgsfield_job_id", null)
    .lt("created_at", stuckCutoff);

  if (stuckQueued?.length) {
    await supabase.from("creative_generations")
      .update({ status: "error", error_message: "Зависло в очереди (job не был создан). Нажмите Перегенерировать." })
      .in("id", stuckQueued.map(r => r.id));
  }

  // Poll Higgsfield for Kling video jobs
  const { data: pending } = await supabase
    .from("creative_generations")
    .select("id, higgsfield_job_id, created_at, scene_group_id")
    .in("status", ["processing", "queued"])
    .not("higgsfield_job_id", "is", null);

  if (pending?.length) {
    await Promise.all(
      pending.map(g => pollAndUpdate(
        supabase,
        g.higgsfield_job_id as string,
        g.id as string,
        g.created_at as string,
        g.scene_group_id != null,
      ))
    );
  }

  // Auto-complete scene groups where all scenes are done/error (no longer processing/queued)
  const { data: generatingGroups } = await supabase
    .from("creative_scene_groups")
    .select("id, scene_count")
    .eq("status", "generating");

  if (generatingGroups?.length) {
    await Promise.all(generatingGroups.map(async (group) => {
      const { count: activeCount } = await supabase
        .from("creative_generations")
        .select("id", { count: "exact", head: true })
        .eq("scene_group_id", group.id)
        .in("status", ["queued", "processing"]);

      if (activeCount === 0) {
        // All scenes settled — check if any succeeded
        const { count: doneCount } = await supabase
          .from("creative_generations")
          .select("id", { count: "exact", head: true })
          .eq("scene_group_id", group.id)
          .eq("status", "done");

        await supabase.from("creative_scene_groups").update({
          status: (doneCount ?? 0) > 0 ? "done" : "error",
          ...((doneCount ?? 0) === 0 ? { error_message: "Все сцены завершились с ошибкой" } : {}),
        }).eq("id", group.id);
      }
    }));
  }

  // Poll Higgsfield for lipsync jobs
  const { data: lipsyncPending } = await supabase
    .from("creative_generations")
    .select("id, lipsync_job_id")
    .eq("status", "lipsync")
    .not("lipsync_job_id", "is", null);

  if (lipsyncPending?.length) {
    await Promise.all(
      lipsyncPending.map(g => pollLipsync(
        supabase,
        g.lipsync_job_id as string,
        g.id as string,
      ))
    );
  }

  // Auto-submit next lipsync scene (1 at a time — Sync.so free plan concurrency = 1)
  const { data: lipsyncGroups } = await supabase
    .from("creative_scene_groups")
    .select("id")
    .eq("status", "lipsync");

  if (lipsyncGroups?.length) {
    await Promise.all(lipsyncGroups.map(async (group) => {
      // Count scenes currently pending lipsync
      const { count: pendingCount } = await supabase
        .from("creative_generations")
        .select("id", { count: "exact", head: true })
        .eq("scene_group_id", group.id)
        .eq("status", "lipsync");

      if (pendingCount) return; // Still waiting — don't submit another

      // Find next scene that needs lipsync
      const { data: nextScene } = await supabase
        .from("creative_generations")
        .select("id, result_url, audio_url")
        .eq("scene_group_id", group.id)
        .eq("status", "done")
        .not("audio_url", "is", null)
        .is("lipsynced_url", null)
        .order("scene_index", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextScene) {
        // Submit next scene
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
                  { type: "video", url: nextScene.result_url },
                  { type: "audio", url: nextScene.audio_url },
                ],
              }),
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (res.ok) {
            const data = await res.json() as { id?: string };
            if (data.id) {
              await supabase.from("creative_generations").update({
                lipsync_job_id: data.id,
                status: "lipsync",
              }).eq("id", nextScene.id);
            }
          }
        } catch { /* silently skip, retry next poll */ }
      } else {
        // No more scenes need lipsync — group is done
        await supabase.from("creative_scene_groups").update({ status: "done" }).eq("id", group.id);
      }
    }));
  }

  // Poll Creatomate for stitching groups
  const { data: stitchingGroups } = await supabase
    .from("creative_scene_groups")
    .select("id, creatomate_render_id")
    .eq("status", "stitching")
    .not("creatomate_render_id", "is", null);

  if (stitchingGroups?.length) {
    await Promise.all(stitchingGroups.map(async (group) => {
      try {
        const res = await fetch(
          `https://api.creatomate.com/v1/renders/${group.creatomate_render_id}`,
          { headers: { "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}` } }
        );
        if (!res.ok) return;
        const render = await res.json() as { status: string; url?: string; error_message?: string };
        if (render.status === "succeeded" && render.url) {
          await supabase.from("creative_scene_groups").update({
            status: "done", final_url: render.url,
          }).eq("id", group.id);
        } else if (render.status === "failed") {
          await supabase.from("creative_scene_groups").update({
            status: "error", error_message: render.error_message ?? "Creatomate failed",
          }).eq("id", group.id);
        }
      } catch { /* silently skip */ }
    }));
  }

  const { data, error } = await supabase
    .from("creative_generations")
    .select(`
      *,
      briefs (
        id,
        adapted_hook,
        adapted_body,
        adapted_angle,
        format,
        status,
        personas:persona_id (name, code),
        hooks:hook_id (name, code),
        bodies:body_id (name, code),
        angles:angle_id (name, code)
      )
    `)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch scene groups with progress counts
  const { data: groups } = await supabase
    .from("creative_scene_groups")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ ok: true, generations: data ?? [], sceneGroups: groups ?? [] });
}

// PATCH /api/creatives — сохранить revision_note
export async function PATCH(req: NextRequest) {
  const { id, revisionNote } = await req.json() as { id: string; revisionNote: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("creative_generations")
    .update({ revision_note: revisionNote })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
