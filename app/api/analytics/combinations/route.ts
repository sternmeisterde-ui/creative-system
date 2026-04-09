import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";

export interface ComboStat {
  codeA: string;   // e.g. "P1"
  codeB: string;   // e.g. "H2"
  typeA: string;   // "persona"
  typeB: string;   // "hook"
  adCount: number;
  winners: number;
  losers: number;
  leads: number;
  qualLeads: number;
  spend: number;
  cpl: number | null;
  cpql: number | null;
  winRate: number | null;
}

// All pairwise combinations to analyze
const PAIRS: [string, string][] = [
  ["personaCode", "hookCode"],
  ["personaCode", "bodyCode"],
  ["personaCode", "angleCode"],
  ["hookCode",    "bodyCode"],
  ["hookCode",    "angleCode"],
  ["bodyCode",    "angleCode"],
];

const FIELD_TO_TYPE: Record<string, string> = {
  personaCode: "persona",
  hookCode:    "hook",
  bodyCode:    "body",
  angleCode:   "angle",
};

type AggEntry = {
  codeA: string; codeB: string; typeA: string; typeB: string;
  spend: number; leads: number; qualLeads: number;
  adCount: number; winners: number; losers: number;
};

export async function GET() {
  const supabase = createServiceClient();

  const [adsResult, mappingResult] = await Promise.all([
    supabase
      .from("creative_performance")
      .select("ad_name, spend, leads, qual_leads, auto_status")
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

  // For each pair type, build an aggregation map
  const result: Record<string, ComboStat[]> = {};

  for (const [fieldA, fieldB] of PAIRS) {
    const key = `${fieldA}__${fieldB}`;
    const agg: Record<string, AggEntry> = {};

    for (const row of (ads ?? [])) {
      const parts = parseAdNameWithMapping(String(row.ad_name ?? ""), mapping);
      const codeA = parts[fieldA as keyof typeof parts];
      const codeB = parts[fieldB as keyof typeof parts];
      if (!codeA || !codeB) continue;

      const comboKey = `${codeA}|${codeB}`;
      if (!agg[comboKey]) {
        agg[comboKey] = {
          codeA, codeB,
          typeA: FIELD_TO_TYPE[fieldA],
          typeB: FIELD_TO_TYPE[fieldB],
          spend: 0, leads: 0, qualLeads: 0,
          adCount: 0, winners: 0, losers: 0,
        };
      }
      agg[comboKey].spend    += parseFloat(row.spend ?? 0);
      agg[comboKey].leads    += parseInt(row.leads ?? 0);
      agg[comboKey].qualLeads += parseInt(row.qual_leads ?? 0);
      agg[comboKey].adCount++;
      if (row.auto_status === "winner") agg[comboKey].winners++;
      if (row.auto_status === "loser")  agg[comboKey].losers++;
    }

    const combos: ComboStat[] = Object.values(agg).map(a => {
      const decided = a.winners + a.losers;
      return {
        codeA:    a.codeA,
        codeB:    a.codeB,
        typeA:    a.typeA,
        typeB:    a.typeB,
        adCount:  a.adCount,
        winners:  a.winners,
        losers:   a.losers,
        leads:    a.leads,
        qualLeads: a.qualLeads,
        spend:    Math.round(a.spend * 100) / 100,
        cpl:      a.leads > 0 ? Math.round((a.spend / a.leads) * 100) / 100 : null,
        cpql:     a.qualLeads > 0 ? Math.round((a.spend / a.qualLeads) * 100) / 100 : null,
        winRate:  decided > 0 ? Math.round((a.winners / decided) * 100) / 100 : null,
      };
    });

    // Sort: winners first, then by CPL asc, nulls last
    combos.sort((a, b) => {
      if (b.winners !== a.winners) return b.winners - a.winners;
      if (a.cpl == null && b.cpl == null) return b.spend - a.spend;
      if (a.cpl == null) return 1;
      if (b.cpl == null) return -1;
      return a.cpl - b.cpl;
    });

    result[key] = combos;
  }

  return NextResponse.json({ ok: true, combinations: result });
}
