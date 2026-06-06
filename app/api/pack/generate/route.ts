/**
 * POST /api/pack/generate
 *
 * Главный оркестратор «Generate Pack»:
 *   1. Тянет архив (winners / fake_winners / losers) — анализ массива
 *   2. Тянет /library (все существующие P/H/B/A коды)
 *   3. Тянет approved competitor_concepts
 *   4. Claude генерит 20 слотов с distribution 55/25/20
 *      (или 0/80/20 в cold start если нет винеров)
 *   5. Для competitor-слотов с новыми кодами — INSERT в /library
 *   6. Сохраняет session с pack_metadata
 *
 * Не запускает generate-briefs сразу — это делает фронт через POST /api/ai/generate-briefs
 * когда пользователь готов к финальному «жать кнопку».
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";
import { getAiContext, getBusiness, brief as briefConfig } from "@/lib/brief";
import { getSettings } from "@/lib/settings";
import type { Format, AdFlow, PackMetadata, PackSlot, PackSlotCategory } from "@/lib/types";

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PACK_SIZE_DEFAULT = 20;
// Распределение 55/25/20 — winner_family получает округлённый остаток
// чтобы сумма всегда совпадала с packSize.
function buildDist(packSize: number, coldStart: boolean): Record<PackSlotCategory, number> {
  if (coldStart) {
    const comp = Math.max(1, Math.round(packSize * 0.20));
    return { winner_family: 0, winner_mix: 0, discovery: packSize - comp, competitor: comp };
  }
  const winnerMix = Math.round(packSize * 0.25);
  const discovery = Math.round(packSize * 0.25);
  const competitor = Math.round(packSize * 0.20);
  const winnerFamily = Math.max(0, packSize - winnerMix - discovery - competitor);
  return { winner_family: winnerFamily, winner_mix: winnerMix, discovery, competitor };
}

interface RequestBody {
  flow:     AdFlow;
  format:   Format;
  packSize?: number;
}

interface CodeRow { code: string | null; name: string; description?: string | null }

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody;
  const { flow, format } = body;
  const packSize = Math.max(3, Math.min(50, Number(body.packSize) || PACK_SIZE_DEFAULT));
  if (!flow || !format) {
    return NextResponse.json({ error: "flow и format обязательны" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const settings = await getSettings();

  // ── 1. Подгружаем библиотеку (все P/H/B/A) ─────────────────────────────────
  const [pRes, hRes, bRes, aRes, mappingRes] = await Promise.all([
    supabase.from("personas").select("code, name, description").not("code", "is", null),
    supabase.from("hooks").select("code, name, description").not("code", "is", null),
    supabase.from("bodies").select("code, name, description").not("code", "is", null),
    supabase.from("angles").select("code, name, description").not("code", "is", null),
    supabase.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
  ]);

  const personas = (pRes.data ?? []) as CodeRow[];
  const hooks    = (hRes.data ?? []) as CodeRow[];
  const bodies   = (bRes.data ?? []) as CodeRow[];
  const angles   = (aRes.data ?? []) as CodeRow[];
  const mapping: AdNameMapping[] = (mappingRes.data ?? []).map(r => ({
    adName: r.ad_name, personaCode: r.persona_code, hookCode: r.hook_code,
    bodyCode: r.body_code, angleCode: r.angle_code, format: r.format, flow: r.flow,
  }));

  // ── 2. Архив креативов (творческое состояние пака) ─────────────────────────
  const { data: perfData } = await supabase
    .from("creative_performance")
    .select("ad_name, auto_status, risk_signals, spend, cpl, cpql, cr_lead_to_qual, roas, leads, qual_leads, flow")
    .eq("flow", flow);

  type PerfRow = NonNullable<typeof perfData>[number];
  const all = (perfData ?? []) as PerfRow[];
  const withCodes = all.map(r => ({
    row: r,
    parts: parseAdNameWithMapping(String(r.ad_name ?? ""), mapping),
  }));

  const winners     = withCodes.filter(x => x.row.auto_status === "winner");
  const fakeWinners = withCodes.filter(x => x.row.auto_status === "fake_winner");
  const losers      = withCodes.filter(x => x.row.auto_status === "loser");
  const approvedCompetitors = await loadApprovedCompetitors(supabase);

  // ── 3. Cold start guard ──────────────────────────────────────────────────────
  const coldStart = winners.length === 0;
  if (coldStart && approvedCompetitors.length === 0) {
    return NextResponse.json({
      error: "Нет данных: ни одного винера в архиве и ни одного одобренного концепта конкурентов. " +
             "Загрузи концепты в /competitors (status=approved) или дождись пока появятся винеры.",
    }, { status: 400 });
  }
  let dist: Record<PackSlotCategory, number> = buildDist(packSize, coldStart);
  // Edge case: винеры есть, но нет одобренных конкурентов → competitor-слоты бесполезны,
  // перераспределяем их в discovery (тот же дух «новые гипотезы»).
  if (approvedCompetitors.length === 0 && !coldStart) {
    dist = { ...dist, discovery: dist.discovery + dist.competitor, competitor: 0 };
  }

  // ── 4. Бивариативный сигнал (HELPS / HURTS коды для discovery-слотов) ──────
  const bivariate = computeQuickBivariate(withCodes);

  // ── 5. Claude промпт → 20 слотов JSON ──────────────────────────────────────
  const claudeJson = await askClaudeForSlots({
    flow, format, dist, coldStart, packSize,
    personas, hooks, bodies, angles,
    winners, fakeWinners, losers, approvedCompetitors,
    bivariate, settings: { cplTarget: settings.cplTarget, cpqlTarget: settings.cpqlTarget },
  });

  // ── 6. Для competitor-слотов с новыми кодами → INSERT в /library ────────────
  const newCodesByTable = await persistNewLibraryCodes(supabase, claudeJson.new_library_codes ?? {});

  // ── 7. Финальный pack_metadata ─────────────────────────────────────────────
  const slots: PackSlot[] = (claudeJson.slots ?? []).map((s: Record<string, unknown>, i: number) => ({
    slotId:           Number(s.slot_id ?? i + 1),
    category:         s.category as PackSlotCategory,
    codes:            (s.codes ?? {}) as PackSlot["codes"],
    rationale:        String(s.rationale ?? ""),
    basedOnAd:        s.based_on_ad as string | undefined,
    variedParam:      s.varied_param as PackSlot["variedParam"],
    fromWinners:      s.from_winners as string[] | undefined,
    helpsCodes:       s.helps_codes as string[] | undefined,
    sourceConceptId:  s.source_concept_id as string | undefined,
    newCodesCreated:  s.new_codes_created as string[] | undefined,
  }));

  const packMetadata: PackMetadata = {
    slots,
    distribution: dist,
    cold_start: coldStart,
    format,
    flow,
    data_snapshot: {
      winners: winners.length,
      fake_winners: fakeWinners.length,
      losers: losers.length,
      approved_competitors: approvedCompetitors.length,
    },
  };

  // ── 8. Сохраняем session ───────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const sessionName = `Pack ${today} · ${flow.toUpperCase()} · ${format}`;

  const uniqueCodes = (key: keyof PackSlot["codes"]) =>
    Array.from(new Set(slots.map(s => s.codes[key]).filter((c): c is string => !!c)));

  const { data: session, error: sessErr } = await supabase
    .from("constructor_sessions")
    .insert({
      name: sessionName,
      flow,
      format,
      total_combinations: packSize,
      pack_size: packSize,
      pack_metadata: packMetadata,
      generated_at: new Date().toISOString(),
      status: "draft",
      // selected_* поля оставляем пустыми (старая ручная семантика не нужна)
      selected_personas: [],
      selected_hooks:    [],
      selected_bodies:   [],
      selected_angles:   [],
    })
    .select("id")
    .single();

  if (sessErr) {
    return NextResponse.json({ error: `DB insert error: ${sessErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sessionId: session?.id,
    packMetadata,
    newCodesByTable,
    cold_start: coldStart,
    used_uniqueCodes: {
      personas: uniqueCodes("persona"),
      hooks:    uniqueCodes("hook"),
      bodies:   uniqueCodes("body"),
      angles:   uniqueCodes("angle"),
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadApprovedCompetitors(supabase: ReturnType<typeof createServiceClient>) {
  const { data } = await supabase
    .from("competitor_concepts")
    .select("id, source, raw_data, status, ad_name, ad_text, ad_offer, ad_psychology")
    .eq("status", "approved")
    .limit(30);
  return data ?? [];
}

interface BivariateSignal {
  code: string;
  paramType: "persona" | "hook" | "body" | "angle";
  verdict: "HELPS" | "HURTS" | "NEUTRAL" | "INSUFFICIENT";
  ratio: number | null;
}

type WithCodes = {
  row: { ad_name: string; auto_status: string; spend: number; leads: number; cpl: number | null };
  parts: { personaCode: string | null; hookCode: string | null; bodyCode: string | null; angleCode: string | null };
};

function computeQuickBivariate(rows: WithCodes[]): BivariateSignal[] {
  const results: BivariateSignal[] = [];
  const params: Array<{ type: BivariateSignal["paramType"]; key: keyof WithCodes["parts"] }> = [
    { type: "persona", key: "personaCode" },
    { type: "hook",    key: "hookCode" },
    { type: "body",    key: "bodyCode" },
    { type: "angle",   key: "angleCode" },
  ];
  for (const { type, key } of params) {
    const codes = Array.from(new Set(rows.map(r => r.parts[key]).filter((c): c is string => !!c)));
    for (const code of codes) {
      const withAds = rows.filter(r => r.parts[key] === code);
      const without = rows.filter(r => r.parts[key] !== code);
      const wSpend = withAds.reduce((s, r) => s + Number(r.row.spend ?? 0), 0);
      const wLeads = withAds.reduce((s, r) => s + Number(r.row.leads ?? 0), 0);
      const oSpend = without.reduce((s, r) => s + Number(r.row.spend ?? 0), 0);
      const oLeads = without.reduce((s, r) => s + Number(r.row.leads ?? 0), 0);
      const wCpl = wLeads > 0 ? wSpend / wLeads : null;
      const oCpl = oLeads > 0 ? oSpend / oLeads : null;
      const ratio = wCpl != null && oCpl != null ? wCpl / oCpl : null;
      const verdict: BivariateSignal["verdict"] =
        ratio == null || wLeads < 3 || oLeads < 3 ? "INSUFFICIENT" :
        ratio < 0.75 ? "HELPS" : ratio > 1.33 ? "HURTS" : "NEUTRAL";
      results.push({ code, paramType: type, verdict, ratio: ratio != null ? Math.round(ratio * 1000) / 1000 : null });
    }
  }
  return results;
}

// ── Claude prompt ────────────────────────────────────────────────────────────

interface AskInput {
  flow: AdFlow;
  format: Format;
  dist: Record<PackSlotCategory, number>;
  coldStart: boolean;
  packSize: number;
  personas: CodeRow[];
  hooks:    CodeRow[];
  bodies:   CodeRow[];
  angles:   CodeRow[];
  winners:     WithCodes[];
  fakeWinners: WithCodes[];
  losers:      WithCodes[];
  approvedCompetitors: Array<{ id: string; source?: string; ad_name?: string | null; ad_text?: string | null; ad_offer?: string | null; ad_psychology?: string | null }>;
  bivariate: BivariateSignal[];
  settings: { cplTarget: number; cpqlTarget: number };
}

interface ClaudeResponse {
  slots: Array<Record<string, unknown>>;
  new_library_codes?: Partial<Record<"personas" | "hooks" | "bodies" | "angles", Array<{ code: string; name: string; description?: string }>>>;
}

async function askClaudeForSlots(inp: AskInput): Promise<ClaudeResponse> {
  const briefDesc = `${getBusiness().name}\n\n${getAiContext()}`;

  const codesBlock = (rows: CodeRow[]) =>
    rows.length === 0 ? "  (нет)" : rows.map(r => `  ${r.code}: ${r.name}${r.description ? ` — ${r.description.slice(0, 100)}` : ""}`).join("\n");

  const winnersBlock = inp.winners.slice(0, 15).map(w =>
    `  ${w.row.ad_name} · CPL €${Number(w.row.cpl).toFixed(1)} · spend €${Number(w.row.spend).toFixed(0)} · коды: P=${w.parts.personaCode ?? "?"} H=${w.parts.hookCode ?? "?"} B=${w.parts.bodyCode ?? "?"} A=${w.parts.angleCode ?? "?"}`
  ).join("\n");

  const fakeBlock = inp.fakeWinners.slice(0, 15).map(w =>
    `  ${w.row.ad_name} · CPL €${Number(w.row.cpl).toFixed(1)} · spend €${Number(w.row.spend).toFixed(0)} · коды: P=${w.parts.personaCode ?? "?"} H=${w.parts.hookCode ?? "?"} B=${w.parts.bodyCode ?? "?"} A=${w.parts.angleCode ?? "?"}`
  ).join("\n");

  const losersBlock = inp.losers.slice(0, 10).map(w =>
    `  ${w.row.ad_name} · CPL €${Number(w.row.cpl ?? 0).toFixed(1)} · коды: P=${w.parts.personaCode ?? "?"} H=${w.parts.hookCode ?? "?"} B=${w.parts.bodyCode ?? "?"} A=${w.parts.angleCode ?? "?"}`
  ).join("\n");

  const bivariateBlock = inp.bivariate
    .filter(b => b.verdict === "HELPS" || b.verdict === "HURTS")
    .sort((a, b) => Math.abs((a.ratio ?? 1) - 1) > Math.abs((b.ratio ?? 1) - 1) ? -1 : 1)
    .slice(0, 20)
    .map(b => `  ${b.code} (${b.paramType}) → ${b.verdict} (ratio ${b.ratio})`)
    .join("\n");

  const competitorsBlock = inp.approvedCompetitors.slice(0, 15).map((c, i) =>
    `  [comp-${i + 1}] id=${c.id} · "${(c.ad_name ?? "").slice(0, 50)}"\n    text: ${(c.ad_text ?? "").slice(0, 150)}\n    offer: ${(c.ad_offer ?? "").slice(0, 100)}\n    psychology: ${(c.ad_psychology ?? "").slice(0, 100)}`
  ).join("\n");

  const prompt = `Ты — стратег рекламных креативов Meta Ads.

${briefDesc}

Цели: CPL ≤ €${inp.settings.cplTarget}, CPQL ≤ €${inp.settings.cpqlTarget}.
Поток: ${inp.flow.toUpperCase()} · Формат: ${inp.format.toUpperCase()}

ЗАДАЧА: сформировать ровно ${inp.packSize} креативов в следующем распределении:
  • winner_family — ${inp.dist.winner_family} креативов: «семьи» вокруг винеров, варьируется ровно 1 параметр
  • winner_mix    — ${inp.dist.winner_mix} креативов: свободная смесь P/H/B/A из винеров (новые комбинации)
  • discovery     — ${inp.dist.discovery} креативов: непротестированные комбинации из HELPS-кодов
  • competitor    — ${inp.dist.competitor} креативов: на основе одобренных концептов конкурентов
${inp.coldStart ? "\n⚠️  COLD START: винеров нет, размножать нечего. Только discovery + competitor.\n  Discovery строим из brief context + ai_context. Бивариата нет — комбинируй здраво.\n" : ""}

## БИБЛИОТЕКА КОДОВ
Персоны:
${codesBlock(inp.personas)}
Хуки:
${codesBlock(inp.hooks)}
Боди:
${codesBlock(inp.bodies)}
Энглы:
${codesBlock(inp.angles)}

## АРХИВ
ВИННЕРЫ (${inp.winners.length}):
${winnersBlock || "  (нет)"}

FAKE WINNERS (${inp.fakeWinners.length}) — НЕ КОПИРУЕМ как винеров:
${fakeBlock || "  (нет)"}

ЛУЗЕРЫ (${inp.losers.length}) — комбинации с этими кодами избегаем:
${losersBlock || "  (нет)"}

## БИВАРИАТИВНЫЙ АНАЛИЗ
${bivariateBlock || "  (недостаточно данных)"}

## ОДОБРЕННЫЕ КОНЦЕПТЫ КОНКУРЕНТОВ (${inp.approvedCompetitors.length})
${competitorsBlock || "  (нет одобренных)"}

## ПРАВИЛА
1. winner_family: бери винер из списка, варьируй ровно один параметр (persona/hook/body/angle).
   Новый код для замены — выбирай среди существующих кодов библиотеки с HELPS-вердиктом или
   среди невстречавшихся в винерах. НЕ ставь HURTS-коды.
2. winner_mix: бери P/H/B/A коды из винеров, но смешивай в новых комбинациях (не повторяющих существующий винер).
   Все 4 кода должны существовать в библиотеке.
3. discovery: бери HELPS-коды из бивариата + комбинации, которые НЕ встречались в архиве.
   Все коды должны существовать в библиотеке.
4. competitor: для КАЖДОГО competitor-слота создаёшь НОВЫЕ P/H/B/A коды.
   - Имя кода: P${nextCodeNum(inp.personas)}, H${nextCodeNum(inp.hooks)}, и т.д. (порядково после max существующего)
   - Не обязательно создавать все 4 параметра — можешь оставить часть из существующих если идеально подходит
   - Описывай новые коды в new_library_codes для INSERT в /library
   - Указывай source_concept_id из списка концептов
5. Все 20 слотов должны быть РАЗНЫМИ комбинациями кодов.
6. ЗАПРЕЩЕНО использовать комбинацию, которая уже встречается в винерах или лузерах (дубликаты бесполезны).

## ФОРМАТ ОТВЕТА — СТРОГО JSON, без markdown:
{
  "slots": [
    {
      "slot_id": 1,
      "category": "winner_family",
      "codes": { "persona": "P2", "hook": "H1", "body": "B3", "angle": "A7" },
      "rationale": "Семья от P2-H1-B3-A5: меняем angle на A7 (HELPS по бивариату)",
      "based_on_ad": "P2-H1-B3-A5-UGC-COM",
      "varied_param": "angle"
    },
    {
      "slot_id": 17,
      "category": "competitor",
      "codes": { "persona": "P2", "hook": "H8", "body": "B3", "angle": "A9" },
      "rationale": "Из концепта comp-3: провокационный хук о профессиональной деградации",
      "source_concept_id": "<uuid из competitors>",
      "new_codes_created": ["H8", "A9"]
    }
  ],
  "new_library_codes": {
    "hooks": [
      { "code": "H8", "name": "Профессиональная деградация", "description": "Вопрос «не поздно ли учиться в этом возрасте» через зеркало неудачников из соседнего сегмента" }
    ],
    "angles": [
      { "code": "A9", "name": "Зеркало проигравшего", "description": "Сравнение «вот так делают те, кто застрял, а вот выход»" }
    ]
  }
}`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = (msg.content[0] as { type: string; text: string }).text;
  // Extract JSON — Claude may wrap in code block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude вернул не-JSON: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(jsonMatch[0]) as ClaudeResponse;
  } catch (e) {
    throw new Error(`JSON parse fail: ${(e as Error).message}\n---\n${jsonMatch[0].slice(0, 1500)}`);
  }
}

function nextCodeNum(rows: CodeRow[]): number {
  const nums = rows.map(r => parseInt((r.code ?? "").slice(1), 10)).filter(n => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

// ── Persist new codes from competitor slots ──────────────────────────────────

async function persistNewLibraryCodes(
  supabase: ReturnType<typeof createServiceClient>,
  newCodes: NonNullable<ClaudeResponse["new_library_codes"]>,
) {
  const result: Record<string, string[]> = { personas: [], hooks: [], bodies: [], angles: [] };

  const tables = ["personas", "hooks", "bodies", "angles"] as const;
  const defaultColors: Record<string, string> = {
    personas: briefConfig.creative_matrix.params.find(p => p.key === "persona")?.color ?? "#48B8D0",
    hooks:    briefConfig.creative_matrix.params.find(p => p.key === "hook")?.color    ?? "#C490D1",
    bodies:   briefConfig.creative_matrix.params.find(p => p.key === "body")?.color    ?? "#6EC8A0",
    angles:   briefConfig.creative_matrix.params.find(p => p.key === "angle")?.color   ?? "#FF8B5A",
  };

  for (const t of tables) {
    const items = newCodes[t] ?? [];
    if (items.length === 0) continue;

    // Insert каждый код. На конфликт code — пропускаем.
    for (const item of items) {
      const { error } = await supabase
        .from(t)
        .upsert({
          code: item.code,
          name: item.name,
          description: item.description ?? "",
          color: defaultColors[t],
        }, { onConflict: "code", ignoreDuplicates: true });
      if (!error) result[t].push(item.code);
    }
  }

  return result;
}
