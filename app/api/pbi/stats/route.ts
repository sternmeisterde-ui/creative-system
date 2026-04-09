import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("pbi_metrics")
    .select("ad_name, leads, qual_leads, spend, revenue")
    .like("ad_id", "pbi:%")
    .order("spend", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map(r => ({
    adName:    r.ad_name,
    leads:     r.leads ?? 0,
    qualLeads: r.qual_leads ?? 0,
    spend:     Number(r.spend) || 0,
    revenue:   Number(r.revenue) || 0,
    cpl:       r.leads > 0 ? Number(r.spend) / r.leads : null,
    cpql:      r.qual_leads > 0 ? Number(r.spend) / r.qual_leads : null,
    cr:        r.leads > 0 ? (r.qual_leads / r.leads) * 100 : null,
  }));

  return NextResponse.json({ rows });
}
