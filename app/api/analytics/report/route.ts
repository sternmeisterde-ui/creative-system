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
  ReportKpi, ReportVisual, ReportSignal, ReportHookSignal, ReportFamily, ReportCombo, ReportCompetitor,
  ReportVerification, ReportVerifications,
} from "@/lib/types";

export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── типы ответов соседних роутов (минимально нужные поля) ──────────────────────
interface BivResult { code: string; paramType: string; label: string; ratio: number | null; verdict: string; withHookRate?: number | null; withHoldRate?: number | null; hookRatio?: number | null; hookVerdict?: string }
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

// Все агрегаты считает КОД (не LLM): суммы спенда/лидов по статусам.
// Эти итоги отдаются и нарративу, и проверяющим как авторитетные — чтобы модель
// цитировала точные числа, а не складывала сама (LLM ненадёжны в арифметике).
function statusTotals(perf: PerfRow[]) {
  const g = (st: string) => {
    const rows = perf.filter(r => r.auto_status === st);
    return {
      n: rows.length,
      spend: rows.reduce((a, r) => a + num(r.spend), 0),
      leads: rows.reduce((a, r) => a + num(r.leads), 0),
      qual: rows.reduce((a, r) => a + num(r.qual_leads), 0),
    };
  };
  return { winner: g("winner"), fake: g("fake_winner"), loser: g("loser"), testing: g("testing") };
}

function totalsBlock(perf: PerfRow[]): string {
  const t = statusTotals(perf);
  const r = (x: { n: number; spend: number; leads: number; qual: number }) =>
    `${x.n} шт · спенд €${x.spend.toFixed(0)} · лиды ${x.leads} · qual ${x.qual}`;
  return `## ТОЧНЫЕ ИТОГИ (посчитаны кодом — ЦИТИРУЙ КАК ЕСТЬ; НЕ складывай и НЕ усредняй числа сам)
Виннеры: ${r(t.winner)}
Fake-winners: ${r(t.fake)}
Лузеры: ${r(t.loser)}
В тесте: ${r(t.testing)}`;
}

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

  // Hook rate по кодам (плеи/показы) — отдельное измерение «цепляет ли», особенно хуки (H).
  const toHook = (r: BivResult): ReportHookSignal => ({
    code: r.code, paramType: r.paramType, label: r.label,
    hookRate: r.withHookRate ?? null, holdRate: r.withHoldRate ?? null,
    ratio: r.hookRatio ?? null, verdict: r.hookVerdict ?? "INSUFFICIENT",
  });
  const hookHelps: ReportHookSignal[] = bivResults.filter(r => r.hookVerdict === "HELPS" && r.withHookRate != null)
    .sort((a, b) => (b.hookRatio ?? 0) - (a.hookRatio ?? 0)).slice(0, 10).map(toHook);
  const hookHurts: ReportHookSignal[] = bivResults.filter(r => r.hookVerdict === "HURTS" && r.withHookRate != null)
    .sort((a, b) => (a.hookRatio ?? 9) - (b.hookRatio ?? 9)).slice(0, 10).map(toHook);

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

  const visual: ReportVisual = { helps, hurts, families, combos, competitors, hookHelps, hookHurts };

  // 4. Описания крео (Gemini, mode=creative_desc) — контент для контекста нарратива
  const { data: descRows } = await supabase
    .from("gemini_analyses").select("ad_name, analysis").eq("mode", "creative_desc").not("ad_name", "is", null);
  const descriptions = new Map<string, string>();
  for (const d of (descRows ?? []) as { ad_name: string; analysis: string }[]) {
    const key = (d.ad_name ?? "").trim().toLowerCase();
    if (key && d.analysis && !descriptions.has(key)) descriptions.set(key, d.analysis);
  }

  // 5. Нарратив (один Opus-проход)
  const narrative = await buildNarrative({ flow, business, settings, perf, kpi, visual, descriptions, hookHelps, hookHurts });

  // 5. Две независимые проверки (Gemini + Codex/OpenAI) — аудит чисел и выводов
  const verifications = await buildVerifications({ settings, kpi, visual, perf, narrative });

  // 6. Сохранить снапшот
  const { data: saved, error } = await supabase
    .from("analysis_reports")
    .insert({ flow, kpi, visual, narrative, verifications })
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
  descriptions: Map<string, string>;
  hookHelps: ReportHookSignal[];
  hookHurts: ReportHookSignal[];
}): Promise<string> {
  const { flow, business, settings, perf, kpi, visual, descriptions, hookHelps, hookHurts } = args;
  const kk = (s: string) => (s ?? "").trim().toLowerCase();
  // Описание содержания крео (Gemini) — добавляем к строке, если есть.
  const descOf = (r: PerfRow) => {
    const d = descriptions.get(kk(r.ad_name));
    return d ? `\n    ↳ контент: ${d.replace(/\s+/g, " ").slice(0, 220)}` : "";
  };
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

${totalsBlock(perf)}

## НАСТОЯЩИЕ ВИННЕРЫ (${winners.length})
${winners.slice(0, 15).map(r => `• ${r.ad_name} | CPL ${eur(r.cpl)} | CPQL ${eur(r.cpql)} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"}${descOf(r)}`).join("\n") || "Виннеров нет."}

## ⚠️ FAKE-WINNERS — замаскированные убытки (${fakeWinners.length})
${fakeWinners.slice(0, 12).map(r => `• ${r.ad_name} | spend €${num(r.spend).toFixed(0)} | CPL ${eur(r.cpl)} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"} | ⚑ ${fmtRisk(r.risk_signals)}${descOf(r)}`).join("\n") || "Опасных виннеров нет."}

## ЛУЗЕРЫ (${losers.length})
${losers.slice(0, 10).map(r => `• ${r.ad_name} | CPL ${eur(r.cpl)} | €${num(r.spend).toFixed(0)} спенд${descOf(r)}`).join("\n") || "Лузеров нет."}

## БИВАРИАТ — что помогает / вредит (по всему массиву)
HELPS (снижают CPL): ${visual.helps.map(sig).join("; ") || "—"}
HURTS (повышают CPL): ${visual.hurts.map(sig).join("; ") || "—"}

## HOOK RATE — что цепляет (плеи/показы, ВЫШЕ=лучше; ×N = vs остальные)
Цепляют (особенно смотри хуки H): ${hookHelps.map(h => `${h.code} (${h.paramType}, hook ${h.hookRate?.toFixed(1) ?? "—"}%, ×${h.ratio?.toFixed(2) ?? "—"})`).join("; ") || "—"}
Не цепляют: ${hookHurts.map(h => `${h.code} (${h.paramType}, hook ${h.hookRate?.toFixed(1) ?? "—"}%, ×${h.ratio?.toFixed(2) ?? "—"})`).join("; ") || "—"}
ВАЖНО: hook rate и CPL — РАЗНЫЕ оси. Код может цеплять (высокий hook), но давать дорогой лид, и наоборот. Сопоставь: если хук цепляет, но CPL высокий — проблема не в первых секундах, а дальше (боди/оффер). Если не цепляет и CPL дорогой — меняй хук.

## СЕМЬИ (фикс 3 кода, варьируется 1) — где один свап решает
${visual.families.map(f => `• варьируется ${f.varyingParam} при [${f.shared}]: лучший CPL ${eur(f.bestCpl)} ↔ худший ${eur(f.worstCpl)} (разброс ${eur(f.spread)})`).join("\n") || "Семей недостаточно."}

## КОНКУРЕНТЫ (одобренные концепты)
${visual.competitors.map(c => `• [${c.type ?? "—"}] ${c.title}${c.hook ? ` — хук: ${c.hook}` : ""}`).join("\n") || "Одобренных концептов нет."}

---

ПРАВИЛА ТОЧНОСТИ (строго — иначе отчёт будет отклонён проверкой):
- НЕ вычисляй агрегаты сам (суммы, средние, доли). ВСЕ суммарные числа (спенд/лиды по группам и т.п.) бери ТОЛЬКО из блока «ТОЧНЫЕ ИТОГИ» или из KPI. Если нужного готового числа нет — не приводи его, говори качественно («большинство», «несколько»), без выдуманной цифры.
- Коды P/H/B/A отдельных креативов НЕ даны — НЕ приписывай конкретному объявлению код наугад. Ссылайся на креатив по его ad_name. Коды (CS#/H#/B#/A#) используй ТОЛЬКО те, что реально есть в секциях HELPS/HURTS/СЕМЬИ/КОМБО.
- Любая связка кодов в рекомендациях должна опираться на HELPS/СЕМЬИ/КОМБО выше, а не на догадку.
- Списки виннеров/fake/лузеров — это СРЕЗ (top-N), НЕ весь массив. Не делай выводов «минимальный/максимальный во всём массиве» или «X несёт основную нагрузку» на основе среза — говори только о показанных строках.
- У части строк есть «↳ контент:» — описание содержания крео от Gemini (хук, формат, оффер, визуал). ОПИРАЙСЯ на него: выводы «что работает / что не работает» формулируй через реальный контент (какие хуки/форматы/офферы у виннеров vs лузеров), а не только через коды и метрики. Не выдумывай контент сверх описанного.

Дай структурированный анализ на русском (markdown, секции через "### "):

### 1. Что реально работает
Паттерны настоящих виннеров (НЕ fake): какие коды из HELPS/СЕМЬИ повторяются + ЧТО ОБЩЕГО В КОНТЕНТЕ (хуки/форматы/офферы по описаниям «↳ контент»). Виннеров называй по ad_name.

### 2. ⚠️ Опасные fake-winners
Где замаскированы убытки. Топ самых дорогих fake по сигналам и бюджету. Какие параметры тянут в fake-категорию.

### 3. Что не работает
Паттерны лузеров и HURTS-коды — что выключать и не повторять.

### 4. Хуки (hook rate)
ОТДЕЛЬНЫЙ разбор хуков по блоку HOOK RATE (только видео, 3-сек просмотры/показы). Шкала уровней: <15% Fix-it, 15-25 Workable, 25-35 Solid, 35-45 Strong, 45%+ Elite — называй уровень для топовых хуков. Что цепляет (сильные H-коды) и что нет. ГЛАВНОЕ — сопоставь hook rate с CPL по тем же хукам: если хук цепляет (Strong/Elite), но CPL высокий → проблема НЕ в первых секундах, а в боди/оффере (чинить их); если хук слабый (Fix-it) → менять сам хук. Дай 1-2 конкретных вывода по H-кодам.

### 5. Тренд массива
Состояние пакета: здоровье, доля фейков, риск усталости.

### 6. Рекомендации к производству
Чётко разбей следующий пакет по нашей формуле:
- **55% размножение виннеров** — какие именно виннеры размножать, какой 1 параметр варьировать (опирайся на семьи и HELPS).
- **25% вариации из анализа** — новые комбинации из HELPS-кодов, которых ещё не было; избегай HURTS.
- **20% гипотезы из конкурентов/рынка** — какие углы из одобренных концептов конкурентов превратить в P/H/B/A.

Конкретно, формат кодов P?·H?·B?·A?. Без воды, не больше 950 слов.`;

  const msg = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.find(b => b.type === "text")?.text ?? "";
}

// ── Проверка отчёта: 2 независимые модели (Gemini + Codex/OpenAI) ───────────────

const AUDIT_INSTRUCTION = `Ты — независимый аудитор отчёта по Meta Ads. Дан ДЕТЕРМИНИРОВАННЫЙ свод чисел и текстовый разбор (написан ДРУГОЙ моделью). Проверяй КОРРЕКТНОСТЬ строго по ПРАВИЛАМ КЛАССИФИКАЦИИ, приведённым в контексте, — НЕ по своей наивной эвристике.

ВАЖНО (частые ложные срабатывания — НЕ считай это ошибками):
- ROAS = 0 у МОЛОДОГО ада (age < порога зрелости) — ЭТО НОРМА: цикл сделки 14–30 дней, выручка ещё не дозрела. Молодой winner с ROAS 0 классифицирован ВЕРНО.
- fake_winner с ВЫСОКИМ ROAS — допустимо, если у строки есть risk_signals (напр. short_lifespan): значит причина не в ROAS. Смотри поле signals перед выводом о «неверной классификации».
- Статусы (winner/fake_winner/loser/testing) уже проставлены по правилам в контексте — если они правилам соответствуют, это НЕ ошибка.

ЧТО ПРОВЕРЯТЬ:
1) Аномалии в ЧИСЛАХ: CPQL < CPL; противоречия leads/qual_leads/CR; нереалистичные значения; статус, НЕ соответствующий правилам.
2) Соответствуют ли выводы разбора числам; нет ли галлюцинаций; НЕ делает ли разбор выводов «по всему массиву» из усечённого среза (показан top-N, не всё) — это повод для warning.
3) Обоснованы ли рекомендации (55/25/20).
Верни СТРОГО JSON без markdown и без преамбулы:
{"status":"ok|warning|fail","confidence":0..1,"issues":[{"severity":"high|medium|low","area":"кратко","detail":"что именно не так"}],"summary":"1-2 предложения"}
status=fail — ТОЛЬКО при явных ошибках в данных/выводах (НЕ за следование правилам классификации); warning — обоснованные сомнения; ok — консистентно.`;

function buildAuditContext(args: {
  settings: Awaited<ReturnType<typeof getSettings>>;
  kpi: ReportKpi; visual: ReportVisual; perf: PerfRow[]; narrative: string;
}): string {
  const { settings, kpi, visual, perf, narrative } = args;
  const ROAS_MATURITY = 30;   // age, после которого требуется ROAS (верх цикла сделки)
  const ROAS_WIN_MIN = 1.0;   // минимальный ROAS для зрелого винера
  const eur = (v: number | null) => (v == null ? "—" : `€${v.toFixed(1)}`);
  const sig = (r: PerfRow) => (Array.isArray(r.risk_signals) && r.risk_signals.length ? (r.risk_signals as string[]).join(",") : "—");
  const line = (r: PerfRow) =>
    `${r.ad_name} | spend €${num(r.spend).toFixed(0)} | CPL ${eur(r.cpl)} | CPQL ${eur(r.cpql)} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"} | age ${r.age_days ?? "—"}д | signals ${sig(r)} | leads ${r.leads}/${r.qual_leads}`;
  const winners = perf.filter(r => r.auto_status === "winner");
  const fakeWinners = perf.filter(r => r.auto_status === "fake_winner");
  const losers = perf.filter(r => r.auto_status === "loser");
  return `Цели: CPL ≤ €${settings.cplTarget}, CPQL ≤ €${settings.cpqlTarget}, порог значимости ${settings.minImpressionsForStatus} показов.

ПРАВИЛА КЛАССИФИКАЦИИ (статусы проставлены ПО НИМ — проверяй соответствие, не свою эвристику):
- winner: показы ≥ порога И CPL ≤ цели И CPQL ≤ цели И (ад МОЛОДОЙ age<${ROAS_MATURITY}д ИЛИ ROAS ≥ ${ROAS_WIN_MIN}). Цикл сделки 14–30 дн: у молодых выручка не дозрела → ROAS=0 у молодого винера = НОРМА.
- fake_winner: пороги CPL/CPQL пройдены, но есть риск — зрелый (age≥${ROAS_MATURITY}) с ROAS<${ROAS_WIN_MIN} ЛИБО есть signals (short_lifespan/low_roas_30d). Высокий ROAS у fake_winner ОК, если стоит signal.
- loser: показы ≥ порога И (CPL > цели ИЛИ CPQL > цели). testing: мало показов / нет лидов.

KPI: пакет ${kpi.packHealth}; объявлений ${kpi.activeAds}; спенд €${kpi.totalSpend.toFixed(0)}; blended CPL ${eur(kpi.blendedCpl)}; CPQL ${eur(kpi.blendedCpql)}; виннеры ${kpi.winners}; fake ${kpi.fakeWinners}; лузеры ${kpi.losers}; в тесте ${kpi.testing}.

${totalsBlock(perf)}
(Это авторитетные итоги по ГРУППАМ. Списки ниже — усечённый top-N; НЕ пересчитывай суммы по ним и не сравнивай свою сумму среза с итогами выше.)

ВИННЕРЫ (${winners.length}):
${winners.slice(0, 20).map(line).join("\n") || "—"}

FAKE-WINNERS (${fakeWinners.length}):
${fakeWinners.slice(0, 15).map(line).join("\n") || "—"}

ЛУЗЕРЫ (${losers.length}):
${losers.slice(0, 10).map(line).join("\n") || "—"}

HELPS: ${visual.helps.map(s => `${s.code}(${s.paramType}, ratio ${s.ratio?.toFixed(2) ?? "—"})`).join("; ") || "—"}
HURTS: ${visual.hurts.map(s => `${s.code}(${s.paramType}, ratio ${s.ratio?.toFixed(2) ?? "—"})`).join("; ") || "—"}
СЕМЬИ: ${visual.families.map(f => `${f.varyingParam}@${f.shared}: ${eur(f.bestCpl)}↔${eur(f.worstCpl)}`).join("; ") || "—"}
КОМБО: ${visual.combos.map(c => `${c.codes}: ${c.winners}W ${eur(c.cpl)}`).join("; ") || "—"}

=== РАЗБОР (написан другой моделью — его и проверяй) ===
${narrative}`;
}

function parseVerdict(raw: string, model: string): ReportVerification {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : raw) as Record<string, unknown>;
    const status = ["ok", "warning", "fail"].includes(String(o.status)) ? (o.status as ReportVerification["status"]) : "warning";
    const issues = Array.isArray(o.issues)
      ? (o.issues as Record<string, unknown>[]).slice(0, 12).map(i => ({
          severity: ["high", "medium", "low"].includes(String(i.severity)) ? (i.severity as "high" | "medium" | "low") : "medium",
          area: String(i.area ?? "—").slice(0, 80),
          detail: String(i.detail ?? "").slice(0, 400),
        }))
      : [];
    return { model, status, confidence: typeof o.confidence === "number" ? o.confidence : 0.5, issues, summary: String(o.summary ?? "").slice(0, 600) };
  } catch {
    return { model, status: "error", confidence: 0, issues: [], summary: "Не удалось разобрать ответ модели" };
  }
}

async function verifyWithGemini(ctx: string): Promise<ReportVerification> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { model: "gemini", status: "skipped", confidence: 0, issues: [], summary: "GEMINI_API_KEY не задан" };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${AUDIT_INSTRUCTION}\n\n${ctx}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    if (!r.ok) return { model: "gemini", status: "error", confidence: 0, issues: [], summary: `Gemini HTTP ${r.status}` };
    const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");
    return parseVerdict(text, "gemini");
  } catch (e) {
    return { model: "gemini", status: "error", confidence: 0, issues: [], summary: e instanceof Error ? e.message : String(e) };
  }
}

async function verifyWithCodex(ctx: string): Promise<ReportVerification> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { model: "codex", status: "skipped", confidence: 0, issues: [], summary: "OPENAI_API_KEY не задан" };
  // Codex-модели работают через Responses API (НЕ chat/completions). Responses API
  // также принимает обычные gpt-модели, поэтому используем его для любого OPENAI_MODEL.
  const model = process.env.OPENAI_MODEL ?? "gpt-5.3-codex";
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, instructions: AUDIT_INSTRUCTION, input: ctx }),
    });
    if (!r.ok) return { model: "codex", status: "error", confidence: 0, issues: [], summary: `OpenAI HTTP ${r.status}` };
    const j = await r.json() as { output?: { content?: { type?: string; text?: string }[] }[] };
    const text = (j.output ?? []).flatMap(o => o.content ?? []).map(c => c.text ?? "").join("");
    return parseVerdict(text, "codex");
  } catch (e) {
    return { model: "codex", status: "error", confidence: 0, issues: [], summary: e instanceof Error ? e.message : String(e) };
  }
}

function computeOverall(checks: ReportVerification[]): ReportVerifications["overall"] {
  if (checks.some(c => c.status === "fail")) return "fail";
  if (checks.some(c => c.status === "warning")) return "warning";
  if (checks.some(c => c.status === "ok")) return "ok";
  return "warning"; // ни одна модель не подтвердила (skipped/error) → не «ok»
}

async function buildVerifications(args: {
  settings: Awaited<ReturnType<typeof getSettings>>;
  kpi: ReportKpi; visual: ReportVisual; perf: PerfRow[]; narrative: string;
}): Promise<ReportVerifications> {
  const ctx = buildAuditContext(args);
  const checks = await Promise.all([verifyWithGemini(ctx), verifyWithCodex(ctx)]);
  return { overall: computeOverall(checks), checks };
}
