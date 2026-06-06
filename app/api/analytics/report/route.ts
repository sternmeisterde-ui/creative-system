/**
 * /api/analytics/report — единый отчёт по массиву креативов.
 *
 * POST { flow } — собирает канонические агрегаты (НЕ пересчитывает их сам, а дёргает
 *   существующие роуты analytics + creative_performance + конкуренты), строит детерминированный
 *   visual/kpi и один Opus-проход для текстового нарратива, сохраняет снапшот в analysis_reports.
 * GET ?flow= — последний снапшот по flow + краткая история.
 *
 * Принцип: визуал = детерминированные числа (надёжно, переиспользуемо производством),
 * нарратив = человекочитаемый разбор + рекомендации к производству (55/25/20).
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { getAiContext, getBusiness } from "@/lib/brief";
import type {
  ReportKpi, ReportVisual, ReportSignal, ReportFamily, ReportCombo, ReportCompetitor,
} from "@/lib/types";

export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── типы ответов соседних роутов (минимально нужные поля) ──────────────────────
interface BivResult { code: string; paramType: string; label: string; ratio: number | null; verdict: string }
interface BivFamily { varyingParam: string; sharedPersona?: string; sharedHook?: string; sharedBody?: string; sharedAngle?: string; bestCpl: number | null; worstCpl: number | null }
interface ComboStat { codeA: string; codeB: string; winners: number; cpl: number | null; spend: number }
interface PerfRow {
  ad_name: string; flow: string; auto_status: string; risk_signals: unknown;
  spend: number; impressions: number; cpl: number | null; cpql: number | null;
  leads: number; qual_leads: number; cr_lead_to_qual: number | null; roas: number | null;
  age_days: number | null; lifespan_days: number | null;
}

function baseUrlFrom(req: NextRequest): string {
  const host = req.headers.get("host") ?? "creative.sternmeister.de";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

// ── GET: последний снапшот + история ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const id = req.nextUrl.searchParams.get("id");
  const flow = req.nextUrl.searchParams.get("flow") ?? "all";

  // ?id= — конкретный снапшот из истории; иначе последний по flow
  const latestQuery = id
    ? supabase.from("analysis_reports").select("*").eq("id", id).maybeSingle()
    : supabase.from("analysis_reports").select("*").eq("flow", flow)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: latest } = await latestQuery;

  const { data: history } = await supabase
    .from("analysis_reports")
    .select("id, created_at, flow, kpi")
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ ok: true, latest: latest ?? null, history: history ?? [] });
}

// ── POST: сгенерировать отчёт ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { flow = "all" } = await req.json().catch(() => ({})) as { flow?: string };
  const supabase = createServiceClient();
  const settings = await getSettings();
  const business = getBusiness();
  const base = baseUrlFrom(req);

  // 1. Канонические агрегаты (соседние роуты) + производительность по flow + конкуренты
  // Лимит высокий: KPI/счётчики статусов считаем по ВСЕМ креативам (грань view — имя,
  // ~сотни-тысяча строк). В промпт Opus уходят только срезы (winners.slice и т.п.),
  // поэтому размер промпта не зависит от лимита.
  let perfQuery = supabase
    .from("creative_performance")
    .select("ad_name, flow, auto_status, risk_signals, spend, impressions, cpl, cpql, leads, qual_leads, cr_lead_to_qual, roas, age_days, lifespan_days")
    .order("spend", { ascending: false })
    .limit(5000);
  if (flow !== "all") perfQuery = perfQuery.eq("flow", flow);

  const [biv, health, combosResp, perfResp, competitorsResp] = await Promise.all([
    fetchJson<{ results: BivResult[]; families: BivFamily[] }>(`${base}/api/analytics/bivariate`),
    fetchJson<{ status: string }>(`${base}/api/analytics/pack-health`),
    fetchJson<{ combinations: Record<string, ComboStat[]> }>(`${base}/api/analytics/combinations`),
    perfQuery,
    supabase.from("competitor_concepts")
      .select("title, concept_type, raw_data")
      .eq("status", "approved")
      .limit(40),
  ]);

  const perf = (perfResp.data ?? []) as PerfRow[];
  if (perf.length === 0) {
    return NextResponse.json({ error: "Нет данных из Meta/PBI. Запусти синхронизацию." }, { status: 400 });
  }

  // 2. KPI (детерминированно, по всем строкам flow)
  const winners     = perf.filter(r => r.auto_status === "winner");
  const fakeWinners = perf.filter(r => r.auto_status === "fake_winner");
  const losers      = perf.filter(r => r.auto_status === "loser");
  const testing     = perf.filter(r => r.auto_status === "testing");
  const sum = (rows: PerfRow[], k: (r: PerfRow) => number) => rows.reduce((a, r) => a + k(r), 0);
  const totalSpend = sum(perf, r => num(r.spend));
  const totalLeads = sum(perf, r => num(r.leads));
  const totalQual  = sum(perf, r => num(r.qual_leads));

  const kpi: ReportKpi = {
    packHealth: (health?.status as ReportKpi["packHealth"]) ?? "unknown",
    winners: winners.length,
    fakeWinners: fakeWinners.length,
    losers: losers.length,
    testing: testing.length,
    blendedCpl: totalLeads > 0 ? totalSpend / totalLeads : null,
    blendedCpql: totalQual > 0 ? totalSpend / totalQual : null,
    totalSpend,
    activeAds: perf.length,
  };

  // 3. Visual-агрегаты (HELPS/HURTS — кросс-массив из bivariate; семьи; комбо; конкуренты)
  const bivResults = biv?.results ?? [];
  const helps: ReportSignal[] = bivResults
    .filter(r => r.verdict === "HELPS")
    .sort((a, b) => (a.ratio ?? 9) - (b.ratio ?? 9))
    .slice(0, 10)
    .map(r => ({ code: r.code, paramType: r.paramType, label: r.label, ratio: r.ratio }));
  const hurts: ReportSignal[] = bivResults
    .filter(r => r.verdict === "HURTS")
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, 10)
    .map(r => ({ code: r.code, paramType: r.paramType, label: r.label, ratio: r.ratio }));

  const families: ReportFamily[] = (biv?.families ?? []).slice(0, 8).map(f => ({
    varyingParam: f.varyingParam,
    shared: [f.sharedPersona, f.sharedHook, f.sharedBody, f.sharedAngle].filter(Boolean).join(" "),
    bestCpl: f.bestCpl,
    worstCpl: f.worstCpl,
    spread: f.bestCpl != null && f.worstCpl != null ? f.worstCpl - f.bestCpl : null,
  }));

  const allCombos = Object.values(combosResp?.combinations ?? {}).flat();
  const combos: ReportCombo[] = allCombos
    .filter(c => c.winners > 0)
    .sort((a, b) => b.winners - a.winners || (a.cpl ?? 9e9) - (b.cpl ?? 9e9))
    .slice(0, 8)
    .map(c => ({ codes: `${c.codeA} + ${c.codeB}`, winners: c.winners, cpl: c.cpl, spend: num(c.spend) }));

  const competitors: ReportCompetitor[] = ((competitorsResp.data ?? []) as { title: string; concept_type?: string; raw_data?: Record<string, unknown> }[])
    .map(c => ({
      title: c.title,
      type: c.concept_type,
      hook: typeof c.raw_data?.ai_hook === "string" ? c.raw_data.ai_hook : undefined,
      reach: num(c.raw_data?.eu_total_reach),
    }))
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 8)
    .map(({ title, type, hook }) => ({ title, type, hook }));

  const visual: ReportVisual = { helps, hurts, families, combos, competitors };

  // 4. Нарратив (один Opus-проход)
  const narrative = await buildNarrative({ flow, business, settings, perf, kpi, visual });

  // 5. Сохранить снапшот
  const { data: saved, error } = await supabase
    .from("analysis_reports")
    .insert({ flow, kpi, visual, narrative })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, report: saved });
}

// ── промпт + Opus ───────────────────────────────────────────────────────────────
async function buildNarrative(args: {
  flow: string;
  business: ReturnType<typeof getBusiness>;
  settings: Awaited<ReturnType<typeof getSettings>>;
  perf: PerfRow[];
  kpi: ReportKpi;
  visual: ReportVisual;
}): Promise<string> {
  const { flow, business, settings, perf, kpi, visual } = args;
  const winners     = perf.filter(r => r.auto_status === "winner");
  const fakeWinners = perf.filter(r => r.auto_status === "fake_winner");
  const losers      = perf.filter(r => r.auto_status === "loser");

  const RISK_LABEL: Record<string, string> = {
    low_qual_cr: "низкая CR Lead→Qual", short_lifespan: "короткий жизненный цикл", low_roas_30d: "ROAS<1",
  };
  const fmtRisk = (s: unknown) => (Array.isArray(s) ? (s as string[]) : []).map(x => RISK_LABEL[x] ?? x).join(", ") || "—";
  const eur = (v: number | null) => (v == null ? "—" : `€${v.toFixed(1)}`);
  const sig = (s: ReportSignal) => `${s.code} (${s.paramType}, ratio ${s.ratio?.toFixed(2) ?? "—"})`;

  const prompt = `Ты — аналитик Meta Ads для ${business.name}. Готовишь ЕДИНЫЙ отчёт по всему массиву креативов перед запуском нового пакета.

${getAiContext()}

Цели: CPL ≤ €${settings.cplTarget}, CPQL ≤ €${settings.cpqlTarget}, порог значимости ${settings.minImpressionsForStatus.toLocaleString()} показов.${flow !== "all" ? `\nПоток: ${flow.toUpperCase()}` : "\nПоток: весь массив (COM+GOV)"}

## СВОДКА МАССИВА
Здоровье пакета: ${kpi.packHealth}. Объявлений: ${kpi.activeAds}. Спенд: €${kpi.totalSpend.toFixed(0)}. Blended CPL: ${eur(kpi.blendedCpl)}, CPQL: ${eur(kpi.blendedCpql)}.
Виннеры: ${kpi.winners} · ⚠️ fake-winners: ${kpi.fakeWinners} · лузеры: ${kpi.losers} · в тесте: ${kpi.testing}.

## НАСТОЯЩИЕ ВИННЕРЫ (${winners.length})
${winners.slice(0, 15).map(r => `• ${r.ad_name} | CPL ${eur(r.cpl)} | CPQL ${eur(r.cpql)} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"}`).join("\n") || "Виннеров нет."}

## ⚠️ FAKE-WINNERS — замаскированные убытки (${fakeWinners.length})
${fakeWinners.slice(0, 12).map(r => `• ${r.ad_name} | spend €${num(r.spend).toFixed(0)} | CPL ${eur(r.cpl)} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"} | ⚑ ${fmtRisk(r.risk_signals)}`).join("\n") || "Опасных виннеров нет."}

## ЛУЗЕРЫ (${losers.length})
${losers.slice(0, 10).map(r => `• ${r.ad_name} | CPL ${eur(r.cpl)} | €${num(r.spend).toFixed(0)} спенд`).join("\n") || "Лузеров нет."}

## БИВАРИАТ — что помогает / вредит (по всему массиву)
HELPS (снижают CPL): ${visual.helps.map(sig).join("; ") || "—"}
HURTS (повышают CPL): ${visual.hurts.map(sig).join("; ") || "—"}

## СЕМЬИ (фикс 3 кода, варьируется 1) — где один свап решает
${visual.families.map(f => `• варьируется ${f.varyingParam} при [${f.shared}]: лучший CPL ${eur(f.bestCpl)} ↔ худший ${eur(f.worstCpl)} (разброс ${eur(f.spread)})`).join("\n") || "Семей недостаточно."}

## КОНКУРЕНТЫ (одобренные концепты)
${visual.competitors.map(c => `• [${c.type ?? "—"}] ${c.title}${c.hook ? ` — хук: ${c.hook}` : ""}`).join("\n") || "Одобренных концептов нет."}

---

Дай структурированный анализ на русском (markdown, секции через "### "):

### 1. Что реально работает
Паттерны только настоящих виннеров (НЕ fake). Какие P/H/B/A повторяются, что подтверждает бивариат (HELPS).

### 2. ⚠️ Опасные fake-winners
Где замаскированы убытки. Топ самых дорогих fake по сигналам и бюджету. Какие параметры тянут в fake-категорию.

### 3. Что не работает
Паттерны лузеров и HURTS-коды — что выключать и не повторять.

### 4. Тренд массива
Состояние пакета: здоровье, доля фейков, риск усталости.

### 5. Рекомендации к производству
Чётко разбей следующий пакет по нашей формуле:
- **55% размножение виннеров** — какие именно виннеры размножать, какой 1 параметр варьировать (опирайся на семьи и HELPS).
- **25% вариации из анализа** — новые комбинации из HELPS-кодов, которых ещё не было; избегай HURTS.
- **20% гипотезы из конкурентов/рынка** — какие углы из одобренных концептов конкурентов превратить в P/H/B/A.

Конкретно, формат кодов P?·H?·B?·A?. Без воды, не больше 800 слов.`;

  const msg = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.find(b => b.type === "text")?.text ?? "";
}
