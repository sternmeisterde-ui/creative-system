import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import type { WeeklyCreativeRow } from "../route";

const key = (s: string) => s.trim().toLowerCase();
const fmt = (n: number | null | undefined, d = 2) => (n == null ? "—" : n.toFixed(d));

// POST /api/analytics/weekly/note
//   { reportId, adId, note }               → сохранить человеческую заметку
//   { reportId, adId, generate: true }     → сгенерировать AI-разбор (Gemini)
export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json().catch(() => ({})) as {
    reportId?: string; adId?: string; note?: string; todo?: string; generate?: boolean;
  };
  const { reportId, adId } = body;
  if (!reportId || !adId) {
    return NextResponse.json({ error: "reportId и adId обязательны" }, { status: 400 });
  }

  // ── ручное сохранение (note и/или todo — незаданные поля не трогаем) ──
  if (!body.generate) {
    const payload: Record<string, unknown> = { report_id: reportId, ad_id: adId, updated_at: new Date().toISOString() };
    if (body.note !== undefined) payload.note = body.note;
    if (body.todo !== undefined) payload.todo = body.todo;
    const { error } = await supabase.from("weekly_creative_notes").upsert(payload, { onConflict: "report_id,ad_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── AI-разбор ──
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY не задан" }, { status: 400 });

  const { data: report } = await supabase
    .from("weekly_creative_reports").select("rows").eq("id", reportId).maybeSingle();
  const row = (report?.rows as WeeklyCreativeRow[] | undefined)?.find(r => r.adId === adId);
  if (!row) return NextResponse.json({ error: "крео не найдено в снапшоте" }, { status: 404 });

  // содержание/параметры крео из Gemini-разбора (если есть)
  const { data: gRows } = await supabase
    .from("gemini_analyses").select("ad_name, analysis, mode")
    .in("mode", ["creative_desc", "creative_params"]).not("ad_name", "is", null);
  const forThis = (gRows ?? []).filter(d => key(d.ad_name as string) === key(row.adName));
  const desc = forThis.find(d => d.mode === "creative_desc")?.analysis ?? "";
  const paramsRaw = forThis.find(d => d.mode === "creative_params")?.analysis ?? "";
  let paramsLine = "";
  if (paramsRaw) {
    try {
      const p = JSON.parse(paramsRaw) as Record<string, string>;
      paramsLine = `Параметры (авторазбор): персона — ${p.persona}; хук — ${p.hook}; энгл — ${p.angle}; боди — ${p.body}; чем силён — ${p.strength}.`;
    } catch { /* битый JSON — пропускаем */ }
  }

  const metrics = [
    `Spend €${fmt(row.spend)}`, `Impressions ${row.impressions}`, `CPM €${fmt(row.cpm)}`,
    `CTR ${fmt(row.ctr)}%`, `CPC €${fmt(row.cpc)}`, `CR click→lead ${fmt(row.crClickLead)}%`,
    `Leads ${row.leads}`, `CPL €${fmt(row.cpl)}`, `Qual leads ${row.qualLeads}`, `CPQL €${fmt(row.cpql)}`,
    `Hook rate ${fmt(row.hookRate, 1)}%`, `Hold rate ${fmt(row.holdRate, 1)}%`, `Статус: ${row.status}`,
  ].join(" · ");

  const prompt = `Ты — медиабайер SternMeister (курс «Бухгалтер в Германии»). Дай КОРОТКИЙ (3-5 предложений) субъективный разбор креатива за прошлую неделю: что сработало/не сработало, гипотеза почему, что попробовать дальше. Пиши по-русски, без воды, конкретно по цифрам.

Креатив: ${row.adName} (формат ${row.format ?? "?"}, поток ${row.flow ?? "?"}).
Метрики: ${metrics}.
${paramsLine}
${desc ? `Содержание крео (авторазбор): ${desc}` : ""}`;

  let aiNote = "";
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!r.ok) return NextResponse.json({ error: `Gemini HTTP ${r.status}` }, { status: 502 });
    const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    aiNote = (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("").trim();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // текущая заметка: если человек ещё ничего не писал — подставляем AI-черновик
  const { data: existing } = await supabase
    .from("weekly_creative_notes").select("note").eq("report_id", reportId).eq("ad_id", adId).maybeSingle();
  const note = existing?.note?.trim() ? existing.note : aiNote;

  const { error: upErr } = await supabase.from("weekly_creative_notes").upsert(
    { report_id: reportId, ad_id: adId, note, ai_note: aiNote, updated_at: new Date().toISOString() },
    { onConflict: "report_id,ad_id" }
  );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ aiNote, note });
}
