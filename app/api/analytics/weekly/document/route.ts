import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext } from "@/lib/brief";
import type { WeeklyCreativeRow } from "../route";
import type { CreativeParams } from "@/lib/gemini";

// Итоговый документ «Что делаем»: Claude сводит ту-ду + разбор недели + шторм +
// параметры крео в ОДИН структурный документ направлений на следующую пачку,
// готовый стать основой для ТЗ на крео. Сохраняется в weekly_creative_reports.document.
export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const k = (s: string) => (s ?? "").trim().toLowerCase();
const eur = (n: number | null) => (n == null ? "—" : `€${n.toFixed(1)}`);

export async function POST(req: NextRequest) {
  const { reportId } = await req.json().catch(() => ({})) as { reportId?: string };
  if (!reportId) return NextResponse.json({ error: "reportId обязателен" }, { status: 400 });
  const sb = createServiceClient();

  const { data: rep } = await sb.from("weekly_creative_reports")
    .select("label, rows, summary, summary_note").eq("id", reportId).maybeSingle();
  if (!rep) return NextResponse.json({ error: "отчёт не найден" }, { status: 404 });
  const rows = (rep.rows ?? []) as WeeklyCreativeRow[];
  if (rows.length === 0) return NextResponse.json({ error: "в неделе нет крео" }, { status: 400 });

  // заметки (todo + субъективный разбор) по крео
  const { data: notes } = await sb.from("weekly_creative_notes")
    .select("ad_id, note, todo").eq("report_id", reportId);
  const noteByAd: Record<string, { note: string; todo: string }> = {};
  for (const n of (notes ?? [])) noteByAd[n.ad_id] = { note: n.note ?? "", todo: n.todo ?? "" };

  // параметры крео
  let pr: { ad_name: string; analysis: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("gemini_analyses").select("ad_name, analysis")
      .eq("mode", "creative_params").not("ad_name", "is", null).range(from, from + 999);
    pr = pr.concat((data ?? []) as { ad_name: string; analysis: string }[]);
    if (!data || data.length < 1000) break;
  }
  const paramByName: Record<string, CreativeParams> = {};
  for (const r of pr) { try { paramByName[k(r.ad_name)] ??= JSON.parse(r.analysis); } catch { /* skip */ } }

  // ── контекст для сборки ──
  const todos = rows.map(r => ({ r, ...(noteByAd[r.adId] ?? { note: "", todo: "" }) }))
    .filter(x => x.todo.trim());
  if (todos.length === 0) {
    return NextResponse.json({ error: "Нет ни одного «Что делаем?» — заполни хотя бы пару крео, из них собирается документ." }, { status: 400 });
  }

  const todoBlock = todos.map(({ r, todo, note }) => {
    const p = paramByName[k(r.adName)];
    const meta = `${r.adName} [${r.status}] CPL ${eur(r.cpl)}, CPQL ${eur(r.cpql)}, hook ${r.hookRate == null ? "—" : r.hookRate.toFixed(0) + "%"}`;
    const par = p ? `\n    параметры: хук — ${p.hook}; энгл — ${p.angle}; персона — ${p.persona}; боди — ${p.body}` : "";
    const subj = note.trim() ? `\n    разбор: ${note.trim()}` : "";
    return `- ЧТО ДЕЛАЕМ: ${todo.trim()}\n    крео: ${meta}${par}${subj}`;
  }).join("\n");

  const system = `Ты — креативный продюсер SternMeister (курс «Бухгалтер в Германии»). ${getAiContext()}

Тебе дают решения команды по крео за неделю («что делаем»), их разбор параметров и метрики, плюс сводный разбор недели. Собери ЕДИНЫЙ документ направлений на следующую пачку крео — так, чтобы из каждого направления продюсер мог написать ТЗ на съёмку/монтаж. Сгруппируй по смыслу (не переписывай список построчно), убери дубли, дай приоритет по потенциалу.`;

  const prompt = `Неделя: ${rep.label}.

РЕШЕНИЯ КОМАНДЫ «ЧТО ДЕЛАЕМ» (основа документа):
${todoBlock}

${rep.summary ? `СВОДНЫЙ РАЗБОР НЕДЕЛИ:\n${rep.summary}\n` : ""}
${rep.summary_note?.trim() ? `ШТОРМ КОМАНДЫ:\n${rep.summary_note.trim()}\n` : ""}

Собери документ в markdown, по-русски, конкретно. Структура:

# Что делаем — пачка крео на неделю ${rep.label}

## Приоритетные направления
Пронумерованный список направлений (сгруппируй решения команды по смыслу). Для КАЖДОГО направления:
- **Название направления** (1 строка)
- Гипотеза и обоснование (из метрик/разбора недели — почему это делаем)
- Формат и персона
- Хук (1-2 варианта, конкретно)
- Энгл и ключевые смыслы боди
- Референс: какие крео этой недели брать за основу (по имени) и что именно копировать
- Сколько вариантов снять

## Что масштабируем / что убиваем
Кратко: рабочие связки на размножение и провальные концепции, которые не трогаем.

## Открытые вопросы к команде
Что нужно уточнить перед ТЗ (если есть).

Пиши так, чтобы документ можно было отдать продюсеру и он собрал ТЗ без дополнительных пояснений.`;

  let document = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3500,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    document = msg.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("").trim();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!document) return NextResponse.json({ error: "Claude вернул пустой документ" }, { status: 502 });

  const { error } = await sb.from("weekly_creative_reports").update({ document }).eq("id", reportId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ document, todoCount: todos.length });
}
