import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";

export interface ParamStat {
  code: string;
  paramType: "persona" | "hook" | "body" | "angle";
  spend: number;
  impressions: number;
  leads: number;
  qualLeads: number;
  cpl: number | null;      // spend / leads
  cpql: number | null;     // spend / qualLeads
  adCount: number;
  winnerCount: number;
  fakeWinnerCount: number;
  loserCount: number;
  winRate: number | null;  // winners / (winners + fake_winners + losers) — fakes считаются как «не победа»
}

type ParamType = "persona" | "hook" | "body" | "angle";

// GET /api/analytics/params — aggregate creative_performance by parameter codes (includes CPL/CPQL)
export async function GET() {
  const supabase = createServiceClient();

  const [adsResult, mappingResult] = await Promise.all([
    supabase
      .from("creative_performance")
      .select("ad_name, spend, impressions, leads, qual_leads, cpl, cpql, auto_status")
      .not("ad_name", "is", null),
    supabase.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
  ]);

  if (adsResult.error) return NextResponse.json({ error: adsResult.error.message }, { status: 500 });

  const mapping: AdNameMapping[] = (mappingResult.data ?? []).map(r => ({
    adName:      r.ad_name,
    personaCode: r.persona_code,
    hookCode:    r.hook_code,
    bodyCode:    r.body_code,
    angleCode:   r.angle_code,
    format:      r.format,
    flow:        r.flow,
  }));

  const ads = adsResult.data;

  const agg: Record<string, {
    code: string;
    paramType: ParamType;
    spend: number;
    impressions: number;
    leads: number;
    qualLeads: number;
    adCount: number;
    winnerCount: number;
    fakeWinnerCount: number;
    loserCount: number;
  }> = {};

  const ensure = (code: string, type: ParamType) => {
    if (!agg[code]) agg[code] = {
      code, paramType: type,
      spend: 0, impressions: 0, leads: 0, qualLeads: 0,
      adCount: 0, winnerCount: 0, fakeWinnerCount: 0, loserCount: 0,
    };
  };

  for (const row of (ads ?? [])) {
    const name = String(row.ad_name ?? "");
    const parts = parseAdNameWithMapping(name, mapping);
    const spend       = parseFloat(row.spend ?? 0);
    const impressions = parseInt(row.impressions ?? 0);
    const leads       = parseInt(row.leads ?? 0);
    const qualLeads   = parseInt(row.qual_leads ?? 0);
    const status      = row.auto_status as string;

    const pairs: [string | null, ParamType][] = [
      [parts.personaCode, "persona"],
      [parts.hookCode,    "hook"],
      [parts.bodyCode,    "body"],
      [parts.angleCode,   "angle"],
    ];

    for (const [code, type] of pairs) {
      if (!code) continue;
      ensure(code, type);
      agg[code].spend       += spend;
      agg[code].impressions += impressions;
      agg[code].leads       += leads;
      agg[code].qualLeads   += qualLeads;
      agg[code].adCount++;
      if (status === "winner")      agg[code].winnerCount++;
      if (status === "fake_winner") agg[code].fakeWinnerCount++;
      if (status === "loser")       agg[code].loserCount++;
    }
  }

  const stats: ParamStat[] = Object.values(agg).map(a => {
    // winRate: настоящие виннеры / (виннеры + fake + лузеры).
    // fake_winners идут в знаменатель, но НЕ в числитель — они «прошли по KPI,
    // но не принесли реальной победы», т.е. неудача того же класса что лузер.
    const decided = a.winnerCount + a.fakeWinnerCount + a.loserCount;
    return {
      code:            a.code,
      paramType:       a.paramType,
      spend:           Math.round(a.spend * 100) / 100,
      impressions:     a.impressions,
      leads:           a.leads,
      qualLeads:       a.qualLeads,
      cpl:             a.leads > 0 ? Math.round((a.spend / a.leads) * 100) / 100 : null,
      cpql:            a.qualLeads > 0 ? Math.round((a.spend / a.qualLeads) * 100) / 100 : null,
      adCount:         a.adCount,
      winnerCount:     a.winnerCount,
      fakeWinnerCount: a.fakeWinnerCount,
      loserCount:      a.loserCount,
      winRate:         decided > 0 ? Math.round((a.winnerCount / decided) * 100) / 100 : null,
    };
  });

  // Sort by CPL asc (best first), nulls last
  stats.sort((a, b) => {
    if (a.cpl == null && b.cpl == null) return b.spend - a.spend;
    if (a.cpl == null) return 1;
    if (b.cpl == null) return -1;
    return a.cpl - b.cpl;
  });

  const byType = {
    personas: stats.filter(s => s.paramType === "persona"),
    hooks:    stats.filter(s => s.paramType === "hook"),
    bodies:   stats.filter(s => s.paramType === "body"),
    angles:   stats.filter(s => s.paramType === "angle"),
  };

  return NextResponse.json({ ok: true, stats: byType, total: stats.length });
}
