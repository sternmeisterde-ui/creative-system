/**
 * GET /api/analytics/lineage-graph — данные для визуальной схемы анализа.
 *
 * Детерминированно (без AI): топ-виннеры и лузеры с кодами P/H/B/A + метриками,
 * и «предлагаемые новые креативы» = винер с заменой ОДНОГО параметра на HELPS-код
 * (логика семей / 55%-размножения). Лузеры показывают, что НЕ повторять.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, buildAdName, type AdNameMapping } from "@/lib/naming";

interface PerfRow {
  ad_name: string; flow: string | null; cpl: number | null; cpql: number | null;
  leads: number; qual_leads: number; spend: number;
}
interface BivResult { code: string; paramType: string; verdict: string; ratio: number | null }

type Codes = { persona: string | null; hook: string | null; body: string | null; angle: string | null; format: string | null; flow: string | null };

// порядок предпочтения варьируемого параметра (сначала «креативные»)
const SWAP_ORDER: { type: string; field: keyof Codes }[] = [
  { type: "angle", field: "angle" },
  { type: "body", field: "body" },
  { type: "hook", field: "hook" },
  { type: "persona", field: "persona" },
];

function baseUrlFrom(req: NextRequest): string {
  const host = req.headers.get("host") ?? "creative.sternmeister.de";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const codesOf = (adName: string, mapping: AdNameMapping[]): Codes => {
  const p = parseAdNameWithMapping(adName, mapping);
  return { persona: p.personaCode, hook: p.hookCode, body: p.bodyCode, angle: p.angleCode, format: p.format, flow: p.flow };
};

const WINDOW_DAYS = 90;

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const base = baseUrlFrom(req);
  // только актуальные крео: последний показ за последние WINDOW_DAYS дней
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const [winnersResp, losersResp, mappingResp, biv] = await Promise.all([
    supabase.from("creative_performance")
      .select("ad_name, flow, cpl, cpql, leads, qual_leads, spend, last_seen")
      .eq("auto_status", "winner").gte("last_seen", cutoff)
      .order("cpl", { ascending: true }).limit(1000),
    supabase.from("creative_performance")
      .select("ad_name, flow, cpl, cpql, leads, qual_leads, spend, last_seen")
      .eq("auto_status", "loser").gte("last_seen", cutoff)
      .order("cpl", { ascending: false }).limit(1000),
    supabase.from("ad_name_mapping")
      .select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
    fetch(`${base}/api/analytics/bivariate`).then(r => r.ok ? r.json() : null).catch(() => null) as Promise<{ results: BivResult[] } | null>,
  ]);

  const mapping: AdNameMapping[] = ((mappingResp.data ?? []) as Record<string, string | null>[]).map(m => ({
    adName: m.ad_name as string, personaCode: m.persona_code, hookCode: m.hook_code,
    bodyCode: m.body_code, angleCode: m.angle_code, format: m.format, flow: m.flow,
  }));

  // HELPS / HURTS коды по типу параметра
  const helpsByType: Record<string, string[]> = {};
  const hurts: string[] = [];
  for (const r of biv?.results ?? []) {
    if (r.verdict === "HELPS") (helpsByType[r.paramType] ??= []).push(r.code);
    else if (r.verdict === "HURTS") hurts.push(r.code);
  }

  const toNode = (r: PerfRow) => ({
    adName: r.ad_name, codes: codesOf(r.ad_name, mapping),
    cpl: r.cpl, cpql: r.cpql, leads: r.leads, qualLeads: r.qual_leads, spend: r.spend,
  });

  // Схема про логику P/H/B/A → оставляем крео с полными кодами (из имени или маппинга);
  // незакодированные легаси не дают «предложение» (нечего варьировать).
  // весь массив актуальных крео с полными кодами (не топ-N)
  const fullyCoded = (n: { codes: Codes }) => !!(n.codes.persona && n.codes.hook && n.codes.body && n.codes.angle);
  const winners = ((winnersResp.data ?? []) as PerfRow[]).map(toNode).filter(fullyCoded);
  const losers  = ((losersResp.data ?? []) as PerfRow[]).map(toNode).filter(fullyCoded);

  // Предложения: винер + замена 1 параметра на HELPS-код, которого у него ещё нет
  const proposals = winners.map((w, i) => {
    const c = w.codes;
    if (!c.persona || !c.hook || !c.body || !c.angle) return null;
    for (const { type, field } of SWAP_ORDER) {
      const cands = (helpsByType[type] ?? []).filter(code => code !== c[field]);
      if (cands.length === 0) continue;
      const newCode = cands[0];
      const next: Codes = { ...c, [field]: newCode };
      return {
        fromWinner: i,
        changedParam: type,
        oldCode: c[field] as string,
        newCode,
        codes: next,
        adName: buildAdName(next.persona!, next.hook!, next.body!, next.angle!, c.format ?? "UGC", c.flow ?? "COM"),
      };
    }
    return null;
  }).filter(Boolean);

  return NextResponse.json({
    ok: true,
    winners, losers, proposals,
    hurts: hurts.slice(0, 8),
    windowDays: WINDOW_DAYS,
    hasData: winners.length > 0,
  });
}
