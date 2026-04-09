import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

interface PbiRow {
  ad_name: string;
  leads: number;
  qual_leads: number;
  spend?: number;
  revenue?: number;
}

// POST /api/pbi/upload
// Stores PBI/Elly campaign data as-is. CPL is calculated directly from PBI spend.
// No matching with meta_ads needed — PBI already has spend + leads matched.
export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json() as { rows: PbiRow[] };
  const { rows } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  }

  const TODAY = new Date().toISOString().slice(0, 10);

  const payload = rows
    .filter(r => r.ad_name && r.ad_name.trim())
    .map(r => ({
      ad_id:      `pbi:${r.ad_name.trim()}`,
      ad_name:    r.ad_name.trim(),
      date:       TODAY,
      leads:      Math.round(Number(r.leads) || 0),
      qual_leads: Math.round(Number(r.qual_leads) || 0),
      spend:      Number(r.spend) || 0,
      revenue:    Number(r.revenue) || 0,
    }));

  if (payload.length === 0) {
    return NextResponse.json({ error: "Нет строк с названием кампании" }, { status: 400 });
  }

  const { error } = await supabase
    .from("pbi_metrics")
    .upsert(payload, { onConflict: "ad_id,date" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("pbi_sync_log").insert({ rows_count: payload.length });

  return NextResponse.json({ ok: true, uploaded: payload.length });
}
