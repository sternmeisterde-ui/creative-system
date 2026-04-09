import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// PATCH /api/creative-gen/scene-group-status — save montage_notes
export async function PATCH(req: NextRequest) {
  const { id, montageNotes } = await req.json() as { id: string; montageNotes: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("creative_scene_groups")
    .update({ montage_notes: montageNotes })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const CREATOMATE_API = "https://api.creatomate.com/v1";
const CREATOMATE_KEY = process.env.CREATOMATE_API_KEY;

async function pollCreatomate(renderId: string) {
  const res = await fetch(`${CREATOMATE_API}/renders/${renderId}`, {
    headers: { "Authorization": `Bearer ${CREATOMATE_KEY}` },
  });
  if (!res.ok) throw new Error(`Creatomate poll ${res.status}`);
  return res.json() as Promise<{ id: string; status: string; url?: string; error_message?: string }>;
}

// GET /api/creative-gen/scene-group-status?id={sceneGroupId}
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: group } = await supabase
    .from("creative_scene_groups")
    .select("*")
    .eq("id", id)
    .single();

  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: scenes } = await supabase
    .from("creative_generations")
    .select("id, scene_index, status, result_url, error_message, prompt, created_at, higgsfield_job_id")
    .eq("scene_group_id", id)
    .order("scene_index", { ascending: true });

  const sceneList = scenes ?? [];
  const done    = sceneList.filter(s => s.status === "done").length;
  const errored = sceneList.filter(s => s.status === "error").length;
  const total   = sceneList.length;

  // Auto-close group when all scenes settled
  if (total > 0 && done + errored === total && group.status === "generating") {
    const finalStatus = done > 0 ? "done" : "error";
    await supabase.from("creative_scene_groups").update({ status: finalStatus }).eq("id", id);
    group.status = finalStatus;
  }

  // Poll Creatomate if stitching is in progress
  if (group.status === "stitching" && group.creatomate_render_id && CREATOMATE_KEY) {
    try {
      const render = await pollCreatomate(group.creatomate_render_id as string);
      if (render.status === "succeeded" && render.url) {
        await supabase.from("creative_scene_groups").update({
          status: "done",
          final_url: render.url,
        }).eq("id", id);
        group.status = "done";
        group.final_url = render.url;
      } else if (render.status === "failed") {
        await supabase.from("creative_scene_groups").update({
          status: "error",
          error_message: render.error_message ?? "Creatomate render failed",
        }).eq("id", id);
        group.status = "error";
      }
    } catch {
      // silently skip — will retry on next poll
    }
  }

  return NextResponse.json({
    ok: true,
    group: { ...group, scenes_done: done, scenes_error: errored },
    scenes: sceneList,
  });
}
