import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export interface AdNameMapping {
  id: string;
  adName: string;
  personaCode: string | null;
  hookCode: string | null;
  bodyCode: string | null;
  angleCode: string | null;
  format: string | null;
  flow: string | null;
  note: string | null;
}

function toClient(r: Record<string, unknown>): AdNameMapping {
  return {
    id:          r.id as string,
    adName:      r.ad_name as string,
    personaCode: r.persona_code as string | null,
    hookCode:    r.hook_code as string | null,
    bodyCode:    r.body_code as string | null,
    angleCode:   r.angle_code as string | null,
    format:      r.format as string | null,
    flow:        r.flow as string | null,
    note:        r.note as string | null,
  };
}

// GET — все маппинги
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ad_name_mapping")
    .select("*")
    .order("ad_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mappings: (data ?? []).map(toClient) });
}

// POST — upsert маппинга по ad_name
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<AdNameMapping>;
  if (!body.adName?.trim()) {
    return NextResponse.json({ error: "adName required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ad_name_mapping")
    .upsert({
      ad_name:      body.adName.trim(),
      persona_code: body.personaCode?.trim().toUpperCase() || null,
      hook_code:    body.hookCode?.trim().toUpperCase() || null,
      body_code:    body.bodyCode?.trim().toUpperCase() || null,
      angle_code:   body.angleCode?.trim().toUpperCase() || null,
      format:       body.format?.trim().toLowerCase() || null,
      flow:         body.flow?.trim().toLowerCase() || null,
      note:         body.note?.trim() || null,
    }, { onConflict: "ad_name" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mapping: toClient(data as Record<string, unknown>) });
}

// DELETE — удалить маппинг по id
export async function DELETE(req: NextRequest) {
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("ad_name_mapping").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
