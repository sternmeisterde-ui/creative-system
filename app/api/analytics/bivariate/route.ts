import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BivariateResult {
  code: string;
  paramType: "persona" | "hook" | "body" | "angle" | "format" | "flow";
  label: string | null;
  color: string | null;
  withCount: number;
  withSpend: number;
  withLeads: number;
  withCpl: number | null;
  withWinners: number;
  withFakeWinners: number;
  withLosers: number;
  withoutCount: number;
  withoutSpend: number;
  withoutLeads: number;
  withoutCpl: number | null;
  withoutWinners: number;
  withoutFakeWinners: number;
  withoutLosers: number;
  ratio: number | null;
  verdict: "HELPS" | "HURTS" | "NEUTRAL" | "INSUFFICIENT";
  // Hook rate (плеи/показы) — отдельное измерение «цепляет ли». Выше = лучше,
  // поэтому вердикт инвертирован относительно CPL.
  withHookRate: number | null;
  withoutHookRate: number | null;
  withHoldRate: number | null;
  hookRatio: number | null;
  hookVerdict: "HELPS" | "HURTS" | "NEUTRAL" | "INSUFFICIENT";
}

export interface FamilyMember {
  adName: string;
  code: string;
  spend: number;
  leads: number;
  cpl: number | null;
  autoStatus: string;
}

export interface GenealogyFamily {
  id: string;
  varyingParam: "persona" | "hook" | "body" | "angle";
  sharedPersona: string | null;
  sharedHook: string | null;
  sharedBody: string | null;
  sharedAngle: string | null;
  members: FamilyMember[];
  bestCpl: number | null;
  worstCpl: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function blendedCpl(spend: number, leads: number): number | null {
  return leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;
}

// Семьи: член может задавать best/worst CPL только при достаточном объёме лидов.
// Планка = 5: совпадает с порогом значимости view для риск-сигнала low_qual_cr
// (leads >= 5). Эмпирически 3→5 убирает «худшие» выбросы на 3-4 лидах (€374/€272)
// без потери семей; 10 уже режет покрытие низкообъёмных/свежих адов без выигрыша.
const MIN_FAMILY_LEADS = 5;

function verdict(ratio: number | null, withLeads: number, withoutLeads: number): BivariateResult["verdict"] {
  if (ratio == null || withLeads < 3 || withoutLeads < 3) return "INSUFFICIENT";
  if (ratio < 0.75) return "HELPS";
  if (ratio > 1.33) return "HURTS";
  return "NEUTRAL";
}

// Hook rate: ВЫШЕ = лучше, поэтому пороги зеркальны CPL. Значимость — по показам
// (нужен объём показов, а не лидов): минимум 1000 показов в каждой группе.
function hookVerdict(ratio: number | null, withImpr: number, withoutImpr: number): BivariateResult["verdict"] {
  if (ratio == null || withImpr < 1000 || withoutImpr < 1000) return "INSUFFICIENT";
  if (ratio > 1.33) return "HELPS";
  if (ratio < 0.75) return "HURTS";
  return "NEUTRAL";
}

// ── GET /api/analytics/bivariate ─────────────────────────────────────────────

export async function GET() {
  const supabase = createServiceClient();

  const [adsResult, mappingResult, personasResult, hooksResult, bodiesResult, anglesResult] = await Promise.all([
    supabase.from("creative_performance").select("ad_name, spend, impressions, leads, qual_leads, auto_status, video_3s, video_thruplay").not("ad_name", "is", null),
    supabase.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
    supabase.from("personas").select("code, name, color"),
    supabase.from("hooks").select("code, name, color"),
    supabase.from("bodies").select("code, name, color"),
    supabase.from("angles").select("code, name, color"),
  ]);

  if (adsResult.error) return NextResponse.json({ error: adsResult.error.message }, { status: 500 });

  const mapping: AdNameMapping[] = (mappingResult.data ?? []).map(r => ({
    adName: r.ad_name, personaCode: r.persona_code, hookCode: r.hook_code,
    bodyCode: r.body_code, angleCode: r.angle_code, format: r.format, flow: r.flow,
  }));

  // Build label/color lookups
  const labelMap: Record<string, { name: string; color: string }> = {};
  for (const r of [...(personasResult.data ?? []), ...(hooksResult.data ?? []), ...(bodiesResult.data ?? []), ...(anglesResult.data ?? [])]) {
    if (r.code) labelMap[r.code] = { name: r.name, color: r.color ?? "#666" };
  }

  // Parse all ads
  type AdRow = {
    adName: string;
    personaCode: string | null;
    hookCode: string | null;
    bodyCode: string | null;
    angleCode: string | null;
    format: string | null;
    flow: string | null;
    spend: number;
    leads: number;
    impressions: number;
    video3s: number;
    videoThru: number;
    autoStatus: string;
  };

  const ads: AdRow[] = (adsResult.data ?? []).map(row => {
    const parts = parseAdNameWithMapping(String(row.ad_name ?? ""), mapping);
    return {
      adName: String(row.ad_name ?? ""),
      personaCode: parts.personaCode,
      hookCode: parts.hookCode,
      bodyCode: parts.bodyCode,
      angleCode: parts.angleCode,
      format: parts.format?.toUpperCase() ?? null,
      flow: parts.flow?.toUpperCase() ?? null,
      spend: parseFloat(row.spend ?? 0),
      leads: parseInt(row.leads ?? 0),
      impressions: parseInt(row.impressions ?? 0),
      video3s: parseInt(row.video_3s ?? 0),
      videoThru: parseInt(row.video_thruplay ?? 0),
      autoStatus: row.auto_status as string,
    };
  });

  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalLeads = ads.reduce((s, a) => s + a.leads, 0);

  // ── Layer 1: Parametric split ──────────────────────────────────────────────

  const results: BivariateResult[] = [];

  type ParamEntry = { code: string; paramType: BivariateResult["paramType"]; getCode: (a: AdRow) => string | null };
  const paramEntries: ParamEntry[] = [];

  // Collect unique codes per param type
  const uniqueCodes = {
    persona: new Set<string>(),
    hook: new Set<string>(),
    body: new Set<string>(),
    angle: new Set<string>(),
    format: new Set<string>(),
    flow: new Set<string>(),
  };
  for (const a of ads) {
    if (a.personaCode) uniqueCodes.persona.add(a.personaCode);
    if (a.hookCode)    uniqueCodes.hook.add(a.hookCode);
    if (a.bodyCode)    uniqueCodes.body.add(a.bodyCode);
    if (a.angleCode)   uniqueCodes.angle.add(a.angleCode);
    if (a.format)      uniqueCodes.format.add(a.format);
    if (a.flow)        uniqueCodes.flow.add(a.flow);
  }

  for (const code of uniqueCodes.persona) paramEntries.push({ code, paramType: "persona", getCode: a => a.personaCode });
  for (const code of uniqueCodes.hook)    paramEntries.push({ code, paramType: "hook",    getCode: a => a.hookCode });
  for (const code of uniqueCodes.body)    paramEntries.push({ code, paramType: "body",    getCode: a => a.bodyCode });
  for (const code of uniqueCodes.angle)   paramEntries.push({ code, paramType: "angle",   getCode: a => a.angleCode });
  for (const code of uniqueCodes.format)  paramEntries.push({ code, paramType: "format",  getCode: a => a.format });
  for (const code of uniqueCodes.flow)    paramEntries.push({ code, paramType: "flow",    getCode: a => a.flow });

  for (const entry of paramEntries) {
    const withAds    = ads.filter(a => entry.getCode(a) === entry.code);
    const withoutAds = ads.filter(a => entry.getCode(a) !== entry.code);

    const withSpend = withAds.reduce((s, a) => s + a.spend, 0);
    const withLeads = withAds.reduce((s, a) => s + a.leads, 0);
    const woutSpend = withoutAds.reduce((s, a) => s + a.spend, 0);
    const woutLeads = withoutAds.reduce((s, a) => s + a.leads, 0);

    const withWinners      = withAds.filter(a => a.autoStatus === "winner").length;
    const withFakeWinners  = withAds.filter(a => a.autoStatus === "fake_winner").length;
    const withLosers       = withAds.filter(a => a.autoStatus === "loser").length;
    const woutWinners      = withoutAds.filter(a => a.autoStatus === "winner").length;
    const woutFakeWinners  = withoutAds.filter(a => a.autoStatus === "fake_winner").length;
    const woutLosers       = withoutAds.filter(a => a.autoStatus === "loser").length;

    const withCpl   = blendedCpl(withSpend, withLeads);
    const withoutCpl = blendedCpl(woutSpend, woutLeads);
    const ratio = withCpl != null && withoutCpl != null ? Math.round((withCpl / withoutCpl) * 1000) / 1000 : null;

    // Hook/hold rate по группе: только видео-крео (video3s > 0), взвешенно по показам.
    const sum = (arr: AdRow[], f: (a: AdRow) => number) => arr.reduce((s, a) => s + f(a), 0);
    const wImpr = sum(withAds, a => a.impressions), w3s = sum(withAds, a => a.video3s), wThru = sum(withAds, a => a.videoThru);
    const oImpr = sum(withoutAds, a => a.impressions), o3s = sum(withoutAds, a => a.video3s), oThru = sum(withoutAds, a => a.videoThru);
    const rate = (n: number, d: number) => d > 0 ? Math.round((n / d * 100) * 100) / 100 : null;
    const withHookRate = rate(w3s, wImpr), withoutHookRate = rate(o3s, oImpr);
    const withHoldRate = rate(wThru, w3s);
    const hookRatio = withHookRate != null && withoutHookRate ? Math.round((withHookRate / withoutHookRate) * 1000) / 1000 : null;

    const meta = labelMap[entry.code];
    results.push({
      code: entry.code,
      paramType: entry.paramType,
      label: meta?.name ?? null,
      color: meta?.color ?? null,
      withCount: withAds.length,
      withSpend: Math.round(withSpend * 100) / 100,
      withLeads,
      withCpl,
      withWinners,
      withFakeWinners,
      withLosers,
      withoutCount: withoutAds.length,
      withoutSpend: Math.round(woutSpend * 100) / 100,
      withoutLeads: woutLeads,
      withoutCpl,
      withoutWinners:     woutWinners,
      withoutFakeWinners: woutFakeWinners,
      withoutLosers:      woutLosers,
      ratio,
      verdict: verdict(ratio, withLeads, woutLeads),
      withHookRate,
      withoutHookRate,
      withHoldRate,
      hookRatio,
      hookVerdict: hookVerdict(hookRatio, wImpr, oImpr),
    });
  }

  // Sort: HELPS first, then HURTS, then NEUTRAL, then INSUFFICIENT; within each by |ratio - 1| desc
  results.sort((a, b) => {
    const order = { HELPS: 0, HURTS: 1, NEUTRAL: 2, INSUFFICIENT: 3 };
    const oa = order[a.verdict], ob = order[b.verdict];
    if (oa !== ob) return oa - ob;
    const ra = a.ratio != null ? Math.abs(a.ratio - 1) : 0;
    const rb = b.ratio != null ? Math.abs(b.ratio - 1) : 0;
    return rb - ra;
  });

  // ── Layer 2: Genealogy ────────────────────────────────────────────────────

  const families: GenealogyFamily[] = [];
  type VaryingKey = "persona" | "hook" | "body" | "angle";

  const varyingConfigs: {
    key: VaryingKey;
    getCode: (a: AdRow) => string | null;
    groupKey: (a: AdRow) => string;
    buildShared: (a: AdRow) => { sharedPersona: string | null; sharedHook: string | null; sharedBody: string | null; sharedAngle: string | null };
  }[] = [
    {
      key: "angle",
      getCode: a => a.angleCode,
      groupKey: a => [a.personaCode, a.hookCode, a.bodyCode].filter(Boolean).join("|"),
      buildShared: a => ({ sharedPersona: a.personaCode, sharedHook: a.hookCode, sharedBody: a.bodyCode, sharedAngle: null }),
    },
    {
      key: "body",
      getCode: a => a.bodyCode,
      groupKey: a => [a.personaCode, a.hookCode, a.angleCode].filter(Boolean).join("|"),
      buildShared: a => ({ sharedPersona: a.personaCode, sharedHook: a.hookCode, sharedBody: null, sharedAngle: a.angleCode }),
    },
    {
      key: "hook",
      getCode: a => a.hookCode,
      groupKey: a => [a.personaCode, a.bodyCode, a.angleCode].filter(Boolean).join("|"),
      buildShared: a => ({ sharedPersona: a.personaCode, sharedHook: null, sharedBody: a.bodyCode, sharedAngle: a.angleCode }),
    },
    {
      key: "persona",
      getCode: a => a.personaCode,
      groupKey: a => [a.hookCode, a.bodyCode, a.angleCode].filter(Boolean).join("|"),
      buildShared: a => ({ sharedPersona: null, sharedHook: a.hookCode, sharedBody: a.bodyCode, sharedAngle: a.angleCode }),
    },
  ];

  for (const config of varyingConfigs) {
    const groups: Record<string, AdRow[]> = {};
    for (const a of ads) {
      const gk = config.groupKey(a);
      if (!gk || gk.split("|").filter(Boolean).length < 2) continue; // need at least 2 shared codes
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(a);
    }

    for (const [, groupAds] of Object.entries(groups)) {
      // Only include if >= 2 different values of the varying param
      const uniqueVals = new Set(groupAds.map(a => config.getCode(a)).filter(Boolean));
      if (uniqueVals.size < 2) continue;
      // Only include members with spend >= €20
      const qualifiedAds = groupAds.filter(a => a.spend >= 20);
      if (qualifiedAds.length < 2) continue;
      if (new Set(qualifiedAds.map(a => config.getCode(a)).filter(Boolean)).size < 2) continue;
      // Нужен хотя бы один член со значимым объёмом лидов — иначе best/worst считать не из чего.
      if (!qualifiedAds.some(a => a.leads >= MIN_FAMILY_LEADS)) continue;

      const rep = qualifiedAds[0];
      const members: FamilyMember[] = qualifiedAds.map(a => {
        const cpl = blendedCpl(a.spend, a.leads);
        return {
          adName: a.adName,
          code: config.getCode(a) ?? "?",
          spend: Math.round(a.spend * 100) / 100,
          leads: a.leads,
          cpl,
          autoStatus: a.autoStatus,
        };
      }).sort((a, b) => {
        if (a.cpl == null && b.cpl == null) return b.spend - a.spend;
        if (a.cpl == null) return 1;
        if (b.cpl == null) return -1;
        return a.cpl - b.cpl;
      });

      // best/worst — только из членов со значимым объёмом лидов (≥ MIN_FAMILY_LEADS),
      // чтобы 1-2 лидовые ады не задавали выбросный «худший/лучший» CPL.
      const cpls = members
        .filter(m => m.leads >= MIN_FAMILY_LEADS && m.cpl != null)
        .map(m => m.cpl as number);
      families.push({
        id: `${config.key}__${config.groupKey(rep)}`,
        varyingParam: config.key,
        ...config.buildShared(rep),
        members,
        bestCpl:  cpls.length > 0 ? Math.min(...cpls) : null,
        worstCpl: cpls.length > 0 ? Math.max(...cpls) : null,
      });
    }
  }

  // Sort families by CPL spread desc (most interesting first)
  families.sort((a, b) => {
    const spreadA = (a.bestCpl != null && a.worstCpl != null) ? a.worstCpl - a.bestCpl : 0;
    const spreadB = (b.bestCpl != null && b.worstCpl != null) ? b.worstCpl - b.bestCpl : 0;
    return spreadB - spreadA;
  });

  return NextResponse.json({
    ok: true,
    totalAds: ads.length,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalLeads,
    results,
    families: families.slice(0, 30), // top 30 most interesting families
  });
}
