import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const SYNCSO_KEY = process.env.SYNCSO_API_KEY!;
const SYNCSO_API = "https://api.sync.so/v2";
const LIPSYNC_MODEL = "lipsync-2"; // lipsync-2-pro for higher quality

async function submitLipsync(videoUrl: string, audioUrl: string): Promise<string> {
  const res = await fetch(`${SYNCSO_API}/generate`, {
    method: "POST",
    headers: {
      "x-api-key": SYNCSO_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LIPSYNC_MODEL,
      input: [
        { type: "video", url: videoUrl },
        { type: "audio", url: audioUrl },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sync.so ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as { id?: string; status?: string };
  if (!data.id) throw new Error(`No job ID from Sync.so: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}

// POST /api/creative-gen/lipsync-scenes
export async function POST(req: NextRequest) {
  const { sceneGroupId } = await req.json() as { sceneGroupId: string };
  if (!sceneGroupId) return NextResponse.json({ error: "sceneGroupId required" }, { status: 400 });
  if (!SYNCSO_KEY) return NextResponse.json({ error: "SYNCSO_API_KEY не настроен" }, { status: 500 });

  const supabase = createServiceClient();

  // Find the first scene that needs lipsync (no lipsynced_url yet, not currently pending)
  const { data: firstScene } = await supabase
    .from("creative_generations")
    .select("id, result_url, audio_url")
    .eq("scene_group_id", sceneGroupId)
    .eq("status", "done")
    .not("result_url", "is", null)
    .not("audio_url", "is", null)
    .is("lipsynced_url", null)
    .order("scene_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstScene) return NextResponse.json({ ok: true, succeeded: 0, message: "Все сцены уже обработаны" });

  // Submit only 1 scene — the poller will auto-submit next scenes one-by-one
  // (Sync.so free plan allows only 1 concurrent job).
  // Устойчиво: при ошибке Sync.so (rate-limit/транзиент) НЕ валим 500 —
  // возвращаем ok:false, поллер повторит сцену в следующем тике.
  let jobId: string;
  try {
    jobId = await submitLipsync(firstScene.result_url as string, firstScene.audio_url as string);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, succeeded: 0, retryable: true, error: message });
  }

  await supabase.from("creative_generations").update({
    lipsync_job_id: jobId,
    status: "lipsync",
  }).eq("id", firstScene.id);

  await supabase.from("creative_scene_groups")
    .update({ status: "lipsync" })
    .eq("id", sceneGroupId);

  return NextResponse.json({ ok: true, succeeded: 1, queued: "поллер продолжит автоматически" });
}
