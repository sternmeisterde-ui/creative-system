import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ParamStat = {
  code: string;
  paramType: string;
  cpl: number | null;
  cpql: number | null;
  winRate: number | null;
  winnerCount: number;
  loserCount: number;
  adCount: number;
  spend: number;
  impressions: number;
};

async function getParamStats(flow?: string): Promise<ParamStat[]> {
  const supabase = createServiceClient();

  let perfQuery = supabase
    .from("creative_performance")
    .select("ad_name, spend, impressions, leads, qual_leads, cpl, cpql, auto_status, flow")
    .not("ad_name", "is", null);
  if (flow && flow !== "all") perfQuery = perfQuery.eq("flow", flow);
  const { data: ads } = await perfQuery;

  const { data: mappingRows } = await supabase
    .from("ad_name_mapping")
    .select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow");

  const mapping: AdNameMapping[] = (mappingRows ?? []).map(r => ({
    adName: r.ad_name, personaCode: r.persona_code, hookCode: r.hook_code,
    bodyCode: r.body_code, angleCode: r.angle_code, format: r.format, flow: r.flow,
  }));

  const agg: Record<string, { code: string; paramType: string; spend: number; impressions: number; leads: number; qualLeads: number; adCount: number; winnerCount: number; loserCount: number }> = {};
  const ensure = (code: string, type: string) => {
    if (!agg[code]) agg[code] = { code, paramType: type, spend: 0, impressions: 0, leads: 0, qualLeads: 0, adCount: 0, winnerCount: 0, loserCount: 0 };
  };

  for (const row of (ads ?? [])) {
    const parts = parseAdNameWithMapping(String(row.ad_name ?? ""), mapping);
    const spend = parseFloat(row.spend ?? 0);
    const impressions = parseInt(row.impressions ?? 0);
    const leads = parseInt(row.leads ?? 0);
    const qualLeads = parseInt(row.qual_leads ?? 0);
    const status = row.auto_status as string;

    const pairs: [string | null, string][] = [
      [parts.personaCode, "persona"], [parts.hookCode, "hook"],
      [parts.bodyCode, "body"], [parts.angleCode, "angle"],
    ];
    for (const [code, type] of pairs) {
      if (!code) continue;
      ensure(code, type);
      agg[code].spend += spend;
      agg[code].impressions += impressions;
      agg[code].leads += leads;
      agg[code].qualLeads += qualLeads;
      agg[code].adCount++;
      if (status === "winner") agg[code].winnerCount++;
      if (status === "loser") agg[code].loserCount++;
    }
  }

  return Object.values(agg).map(a => {
    const decided = a.winnerCount + a.loserCount;
    return {
      code: a.code, paramType: a.paramType,
      spend: Math.round(a.spend),
      impressions: a.impressions,
      cpl: a.leads > 0 ? Math.round((a.spend / a.leads) * 10) / 10 : null,
      cpql: a.qualLeads > 0 ? Math.round((a.spend / a.qualLeads) * 10) / 10 : null,
      winRate: decided > 0 ? Math.round((a.winnerCount / decided) * 100) : null,
      winnerCount: a.winnerCount, loserCount: a.loserCount, adCount: a.adCount,
    };
  });
}

function formatStats(stats: ParamStat[], type: string): string {
  const filtered = stats.filter(s => s.paramType === type);
  if (!filtered.length) return "  нет данных";
  return filtered.map(s => {
    const parts = [`  ${s.code}:`];
    if (s.cpl != null) parts.push(`CPL €${s.cpl}`);
    if (s.cpql != null) parts.push(`CPQL €${s.cpql}`);
    if (s.winRate != null) parts.push(`winRate ${s.winRate}% (${s.winnerCount}W/${s.loserCount}L из ${s.adCount})`);
    else parts.push(`${s.adCount} объявл., €${s.spend} спенд, не решено`);
    return parts.join(" | ");
  }).join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { personas, hooks, bodies, angles, flow } = await req.json();

    const paramStats = await getParamStats(flow);

    // Build code→id maps from library
    const codeToId: Record<string, string> = {};
    for (const p of personas) if (p.code) codeToId[p.code] = p.id;
    for (const h of hooks) if (h.code) codeToId[h.code] = h.id;
    for (const b of bodies) if (b.code) codeToId[b.code] = b.id;
    for (const a of angles) if (a.code) codeToId[a.code] = a.id;

    const prompt = `Ты — аналитик рекламных креативов Meta Ads для SternMeister (курсы бухгалтерии для иммигрантов в Германии).
Цель: выбрать оптимальный набор параметров (до 3 по каждому типу) для следующего теста.
Поток: ${flow?.toUpperCase() ?? "COM"}
Цели: CPL ≤ €20, CPQL ≤ €28, порог значимости 8000 показов.

СТАТИСТИКА ПО ПАРАМЕТРАМ (из реальных данных Meta):

ПЕРСОНЫ:
${formatStats(paramStats, "persona")}

ХУКИ:
${formatStats(paramStats, "hook")}

БОДИ:
${formatStats(paramStats, "body")}

ЭНГЛЫ:
${formatStats(paramStats, "angle")}

БИБЛИОТЕКА ПАРАМЕТРОВ (code → id):
Персоны: ${personas.map((p: { id: string; name: string; code?: string }) => `${p.code ?? "?"} = ${p.id} (${p.name})`).join(", ")}
Хуки: ${hooks.map((h: { id: string; name: string; code?: string }) => `${h.code ?? "?"} = ${h.id} (${h.name})`).join(", ")}
Боди: ${bodies.map((b: { id: string; name: string; code?: string }) => `${b.code ?? "?"} = ${b.id} (${b.name})`).join(", ")}
Энглы: ${angles.map((a: { id: string; name: string; code?: string }) => `${a.code ?? "?"} = ${a.id} (${a.name})`).join(", ")}

СТРАТЕГИЯ выбора:
1. Если у параметра winRate > 30% и CPL ≤ €25 — включай в тест (проверено, работает).
2. Если у параметра мало данных (< 3 объявлений, impressions < 5000) — включай 1-2 таких (нужно дотестировать).
3. Если у параметра winRate = 0% и CPL > €35 после 8000+ показов — НЕ включай (проигрышный паттерн).
4. Если параметра нет в статистике вообще — включи 1 такой (не тестировался, может быть виннером).
5. Выбирай разнообразие: не все из одной категории "проверено хорошо" — оставляй место для открытий.

Ответь строго в JSON без комментариев:
{
  "personas": ["id1", "id2", "id3"],
  "hooks": ["id1", "id2", "id3"],
  "bodies": ["id1", "id2", "id3"],
  "angles": ["id1", "id2", "id3"],
  "reasoning": "2-3 предложения на русском: почему выбраны эти параметры, что из данных повлияло на выбор, какие гипотезы проверяем"
}`;

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const data = JSON.parse(jsonMatch[0]);

    const validate = (ids: string[], library: { id: string }[]) =>
      (ids ?? []).filter((id: string) => library.some(item => item.id === id)).slice(0, 3);

    const validPersonas = validate(data.personas, personas);
    const validHooks    = validate(data.hooks, hooks);
    const validBodies   = validate(data.bodies, bodies);
    const validAngles   = validate(data.angles, angles);

    return NextResponse.json({
      personas: validPersonas.length ? validPersonas : personas.slice(0, 3).map((p: { id: string }) => p.id),
      hooks:    validHooks.length    ? validHooks    : hooks.slice(0, 3).map((h: { id: string }) => h.id),
      bodies:   validBodies.length   ? validBodies   : bodies.slice(0, 3).map((b: { id: string }) => b.id),
      angles:   validAngles.length   ? validAngles   : angles.slice(0, 3).map((a: { id: string }) => a.id),
      reasoning: data.reasoning ?? "",
      statsUsed: paramStats.length,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
