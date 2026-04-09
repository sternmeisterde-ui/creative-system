import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { buildAdName } from "@/lib/naming";

// POST /api/briefs/publish
// Takes all approved briefs from a session, builds ad names, creates creatives
export async function POST(req: NextRequest) {
  const { sessionId } = await req.json() as { sessionId: string };
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const supabase = createServiceClient();

  // Get session for flow
  const { data: session } = await supabase
    .from("constructor_sessions")
    .select("flow, format")
    .eq("id", sessionId)
    .single();

  const flow = (session?.flow as string) ?? "com";
  const sessionFormat = (session?.format as string) ?? "ugc";

  // Get approved briefs
  const { data: briefs } = await supabase
    .from("briefs")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "approved");

  if (!briefs || briefs.length === 0) {
    return NextResponse.json({ ok: true, created: 0, creatives: [], message: "Нет одобренных брифов" });
  }

  // Collect all unique parameter IDs
  const personaIds = [...new Set(briefs.map(b => b.persona_id).filter(Boolean))];
  const hookIds    = [...new Set(briefs.map(b => b.hook_id).filter(Boolean))];
  const bodyIds    = [...new Set(briefs.map(b => b.body_id).filter(Boolean))];
  const angleIds   = [...new Set(briefs.map(b => b.angle_id).filter(Boolean))];

  // Fetch codes for all params in parallel
  const [pRows, hRows, bRows, aRows] = await Promise.all([
    supabase.from("personas").select("id, code").in("id", personaIds),
    supabase.from("hooks").select("id, code").in("id", hookIds),
    supabase.from("bodies").select("id, code").in("id", bodyIds),
    supabase.from("angles").select("id, code").in("id", angleIds),
  ]);

  const codeOf = (rows: { id: string; code: string | null }[] | null, id: string): string =>
    rows?.find(r => r.id === id)?.code ?? "?";

  const created: { adName: string; briefId: string; creativeId: string }[] = [];

  for (const brief of briefs) {
    const pCode = codeOf(pRows.data, brief.persona_id);
    const hCode = codeOf(hRows.data, brief.hook_id);
    const bCode = codeOf(bRows.data, brief.body_id);
    const aCode = codeOf(aRows.data, brief.angle_id);
    const fmt   = (brief.format ?? sessionFormat).toUpperCase();

    // Skip if any code is missing
    if ([pCode, hCode, bCode, aCode].includes("?")) continue;

    const adName = buildAdName(pCode, hCode, bCode, aCode, fmt, flow);

    // Check if creative with this ad name already exists
    const { data: existing } = await supabase
      .from("creatives")
      .select("id")
      .eq("meta_ad_name", adName)
      .maybeSingle();

    if (existing) {
      created.push({ adName, briefId: brief.id, creativeId: existing.id });
      continue;
    }

    const { data: creative } = await supabase
      .from("creatives")
      .insert({
        source: "internal",
        flow,
        persona_id: brief.persona_id,
        hook_id: brief.hook_id,
        body_id: brief.body_id,
        angle_id: brief.angle_id,
        format: brief.format ?? sessionFormat,
        status: "testing",
        meta_ad_name: adName,
        description: brief.full_brief?.slice(0, 500) ?? null,
      })
      .select("id")
      .single();

    if (creative) {
      created.push({ adName, briefId: brief.id, creativeId: creative.id });
    }
  }

  return NextResponse.json({ ok: true, created: created.length, creatives: created });
}
