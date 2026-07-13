import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext } from "@/lib/brief";
import type { WeeklyCreativeRow } from "../route";
import type { CreativeParams } from "@/lib/gemini";

// Сводный разбор недели: объективные агрегаты (в коде) + Claude синтезирует
// паттерны по извлечённым параметрам (какие хуки/энглы/персоны зашли, что штормить).
export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const k = (s: string) => (s ?? "").trim().toLowerCase();
const eur = (n: number | null) => (n == null ? "—" : `€${n.toFixed(1)}`);
const blendedCpl = (spend: number, leads: number) => (leads > 0 ? spend / leads : null);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { reportId?: string; generate?: boolean; note?: string };
  const { reportId } = body;
  if (!reportId) return NextResponse.json({ error: "reportId обязателен" }, { status: 400 });
  const sb = createServiceClient();

  // Сохранение командного шторма
  if (!body.generate) {
    const { error } = await sb.from("weekly_creative_reports")
      .update({ summary_note: body.note ?? "" }).eq("id", reportId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Генерация AI-разбора ──
  const { data: rep } = await sb.from("weekly_creative_reports")
    .select("week_start, week_end, label, rows").eq("id", reportId).maybeSingle();
  if (!rep) return NextResponse.json({ error: "отчёт не найден" }, { status: 404 });
  const rows = (rep.rows ?? []) as WeeklyCreativeRow[];
  if (rows.length === 0) return NextResponse.json({ error: "в неделе нет крео" }, { status: 400 });

  // параметры крео (что уже разобрано)
  let pr: { ad_name: string; analysis: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("gemini_analyses").select("ad_name, analysis")
      .eq("mode", "creative_params").not("ad_name", "is", null).range(from, from + 999);
    pr = pr.concat((data ?? []) as { ad_name: string; analysis: string }[]);
    if (!data || data.length < 1000) break;
  }
  const paramByName: Record<string, CreativeParams> = {};
  for (const r of pr) { try { paramByName[k(r.ad_name)] ??= JSON.parse(r.analysis); } catch { /* skip */ } }
  const withParams = rows.filter(r => paramByName[k(r.adName)]).length;

  // предыдущая неделя — для WoW
  const { data: prev } = await sb.from("weekly_creative_reports")
    .select("label, rows").lt("week_start", rep.week_start)
    .order("week_start", { ascending: false }).limit(1).maybeSingle();

  // ── объективные агрегаты (в коде) ──
  const agg = (rs: WeeklyCreativeRow[]) => {
    const spend = rs.reduce((a, r) => a + r.spend, 0);
    const leads = rs.reduce((a, r) => a + r.leads, 0);
    const qual  = rs.reduce((a, r) => a + r.qualLeads, 0);
    return { spend, leads, qual, cpl: blendedCpl(spend, leads), cpql: blendedCpl(spend, qual) };
  };
  const cur = agg(rows);
  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const withCpl = rows.filter(r => r.cpl != null && r.leads > 0);
  const topCpl = [...withCpl].sort((a, b) => a.cpl! - b.cpl!).slice(0, 8);
  const botCpl = [...withCpl].sort((a, b) => b.cpl! - a.cpl!).slice(0, 8);

  const byGroup = (keyFn: (r: WeeklyCreativeRow) => string) => {
    const g: Record<string, WeeklyCreativeRow[]> = {};
    for (const r of rows) (g[keyFn(r) || "—"] ??= []).push(r);
    return Object.entries(g).map(([key, rs]) => { const a = agg(rs); return `${key}: ${rs.length} крео, спенд €${a.spend.toFixed(0)}, лидов ${a.leads}, CPL ${eur(a.cpl)}, CPQL ${eur(a.cpql)}`; }).join("\n");
  };

  const line = (r: WeeklyCreativeRow) => {
    const p = paramByName[k(r.adName)];
    const base = `${r.adName} [${r.status}] спенд €${r.spend.toFixed(0)}, лидов ${r.leads}, CPL ${eur(r.cpl)}, CPQL ${eur(r.cpql)}, hook ${r.hookRate == null ? "—" : r.hookRate.toFixed(0) + "%"}`;
    return p ? `${base}\n   хук: ${p.hook}\n   энгл: ${p.angle} · персона: ${p.persona} · боди: ${p.body}` : base;
  };

  const wow = prev ? (() => { const a = agg((prev.rows ?? []) as WeeklyCreativeRow[]); return `Прошлая неделя (${prev.label}): спенд €${a.spend.toFixed(0)}, лидов ${a.leads}, blended CPL ${eur(a.cpl)}, CPQL ${eur(a.cpql)}.`; })() : "Прошлой недели для сравнения нет.";

  const facts = `Неделя ${rep.label}. Крео: ${rows.length} (с разбором параметров: ${withParams}).
ИТОГО: спенд €${cur.spend.toFixed(0)}, лидов ${cur.leads}, квал ${cur.qual}, blended CPL ${eur(cur.cpl)}, CPQL ${eur(cur.cpql)}.
Статусы: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", ")}.
${wow}

Разбивка по ФОРМАТУ:
${byGroup(r => r.format ?? "—")}

Разбивка по ПОТОКУ:
${byGroup(r => (r.flow ?? "—").toUpperCase())}

ЛУЧШИЕ по CPL:
${topCpl.map(line).join("\n")}

ХУДШИЕ по CPL:
${botCpl.map(line).join("\n")}`;

  const system = `Ты — head of growth в SternMeister (курс «Бухгалтер в Германии»). ${getAiContext()}

Тебе дают объективные цифры недели по рекламным крео и (где разобрано) параметры их содержания. Сделай СВОДНЫЙ разбор недели на уровне всей пачки — основу для мозгового штурма новых крео. Не пересказывай цифры построчно, а найди ПАТТЕРНЫ.`;

  const prompt = `${facts}

Дай разбор в markdown, по-русски, конкретно и без воды. Структура:
## Итог недели
2-3 предложения: как отработала пачка в целом (с учётом сравнения с прошлой неделей).

## Что сработало / что нет — по параметрам
Сгруппируй наблюдения по ХУКАМ, ЭНГЛАМ, ПЕРСОНАМ, БОДИ/ФОРМАТАМ: какие типы заходили (низкий CPL/CPQL, высокий hook rate), какие проваливались. Опирайся на параметры разобранных крео; если разобрано мало — так и скажи и опирайся на имена/метрики.

## Над чем штормить
5-8 конкретных гипотез для новых крео на следующую пачку (новые хуки/энглы/персоны/боди/форматы), каждая — с обоснованием из данных этой недели.`;

  let summary = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    summary = msg.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("").trim();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!summary) return NextResponse.json({ error: "Claude вернул пустой разбор" }, { status: 502 });

  const { error } = await sb.from("weekly_creative_reports").update({ summary }).eq("id", reportId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ summary, withParams, total: rows.length });
}
