import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// GET /api/creatives/download?id={generationId}
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: gen } = await supabase
    .from("creative_generations")
    .select(`
      result_url, format, is_static,
      briefs (
        personas:persona_id (code),
        hooks:hook_id (code),
        bodies:body_id (code),
        angles:angle_id (code),
        constructor_sessions:session_id (flow)
      )
    `)
    .eq("id", id)
    .single();

  if (!gen?.result_url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const brief = gen.briefs as {
    personas?: { code?: string } | null;
    hooks?: { code?: string } | null;
    bodies?: { code?: string } | null;
    angles?: { code?: string } | null;
    constructor_sessions?: { flow?: string } | null;
  } | null;

  const p = brief?.personas?.code ?? "P?";
  const h = brief?.hooks?.code ?? "H?";
  const b = brief?.bodies?.code ?? "B?";
  const a = brief?.angles?.code ?? "A?";
  const fmt = (gen.format as string ?? "static").toUpperCase();
  const flow = (brief?.constructor_sessions?.flow as string ?? "").toUpperCase();
  const ext = gen.is_static ? "png" : "mp4";

  const filename = [p, h, b, a, fmt, flow].filter(Boolean).join("·") + "." + ext;

  const imageRes = await fetch(gen.result_url as string);
  if (!imageRes.ok) return NextResponse.json({ error: "Failed to fetch file" }, { status: 502 });

  const buffer = await imageRes.arrayBuffer();
  const contentType = gen.is_static ? "image/png" : "video/mp4";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
