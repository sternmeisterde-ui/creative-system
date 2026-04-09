import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// POST /api/creative-gen/cancel-lipsync
export async function POST(req: NextRequest) {
  const { sceneGroupId } = await req.json() as { sceneGroupId: string };
  if (!sceneGroupId) return NextResponse.json({ error: "sceneGroupId required" }, { status: 400 });

  const supabase = createServiceClient();

  // Reset all lipsync-pending scenes back to done
  await supabase
    .from("creative_generations")
    .update({ status: "done", lipsync_job_id: null })
    .eq("scene_group_id", sceneGroupId)
    .eq("status", "lipsync");

  // Reset group status back to done
  await supabase
    .from("creative_scene_groups")
    .update({ status: "done" })
    .eq("id", sceneGroupId);

  return NextResponse.json({ ok: true });
}
