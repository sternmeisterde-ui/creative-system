import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { flow } = await req.json() as { flow?: string };
  const supabase = createServiceClient();

  // 1. Данные из creative_performance
  let perfQuery = supabase
    .from("creative_performance")
    .select("ad_name, flow, auto_status, spend, impressions, cpl, cpql, ctr, leads, qual_leads")
    .order("spend", { ascending: false })
    .limit(60);
  if (flow && flow !== "all") perfQuery = perfQuery.eq("flow", flow);
  const { data: perfData } = await perfQuery;

  if (!perfData || perfData.length === 0) {
    return NextResponse.json({ error: "Нет данных из Meta. Запусти синхронизацию." }, { status: 400 });
  }

  // 2. Сигналы жизнеспособности пака
  const { data: pbiDaily } = await supabase
    .from("pbi_metrics")
    .select("ad_name, date, spend, leads")
    .gte("date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
    .order("date", { ascending: false });

  const winners = perfData.filter(r => r.auto_status === "winner");
  const losers  = perfData.filter(r => r.auto_status === "loser");
  const testing = perfData.filter(r => r.auto_status === "testing" && r.spend > 10);

  // 3. Топ-5 по CPL (с данными)
  const withCpl = perfData.filter(r => r.cpl != null && r.leads > 0).sort((a, b) => a.cpl - b.cpl);
  const top5cpl = withCpl.slice(0, 5);

  // 4. Дневной CPL последних 3 дней (агрегировано)
  const dailyCpl: Record<string, { spend: number; leads: number }> = {};
  for (const r of pbiDaily ?? []) {
    if (!dailyCpl[r.date]) dailyCpl[r.date] = { spend: 0, leads: 0 };
    dailyCpl[r.date].spend += Number(r.spend) || 0;
    dailyCpl[r.date].leads += Number(r.leads) || 0;
  }
  const dailySummary = Object.entries(dailyCpl)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 5)
    .map(([date, d]) => `${date}: CPL €${d.leads > 0 ? (d.spend / d.leads).toFixed(1) : "нет лидов"}, лидов: ${d.leads}`)
    .join("\n");

  const prompt = `Ты — аналитик Meta Ads для SternMeister (онлайн-курсы бухгалтерии для русскоязычных иммигрантов в Германии).
Цели: CPL ≤ €20, CPQL ≤ €28, порог значимости 8 000 показов.${flow && flow !== "all" ? `\nПоток: ${flow.toUpperCase()}` : ""}

## ВИННЕРЫ (${winners.length} шт.)
${winners.length > 0
  ? winners.map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "—"} | CPQL €${r.cpql?.toFixed(1) ?? "—"} | ${r.impressions?.toLocaleString()} показов | CTR ${r.ctr?.toFixed(2) ?? "—"}%`).join("\n")
  : "Виннеров нет."}

## ЛУЗЕРЫ (${losers.length} шт.)
${losers.length > 0
  ? losers.slice(0, 10).map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "—"} | €${r.spend?.toFixed(0)} спенд | ${r.impressions?.toLocaleString()} показов`).join("\n")
  : "Лузеров нет."}

## В ТЕСТЕ с данными (топ по спенду, ${testing.length} шт.)
${testing.slice(0, 10).map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "нет данных"} | €${r.spend?.toFixed(0)} спенд | ${r.leads ?? 0} лидов`).join("\n")}

## ТОП-5 ПО CPL
${top5cpl.map(r => `• ${r.ad_name}: CPL €${r.cpl?.toFixed(1)}, CPQL €${r.cpql?.toFixed(1) ?? "—"}, ${r.leads} лидов, €${r.spend?.toFixed(0)} спенд`).join("\n") || "Нет данных."}

## ДИНАМИКА CPL ПО ДНЯМ (все объявления агрегировано)
${dailySummary || "Нет данных."}

---

Дай структурированный анализ на русском языке:

### 1. Что работает
Конкретные паттерны из виннеров — что общего в их названиях, какие параметры (P/H/B/A) встречаются, почему они победили.

### 2. Что не работает
Паттерны лузеров — где сливается бюджет, какие параметры стабильно дают высокий CPL.

### 3. Тренд пака
Оценка по динамике последних 5 дней — растёт CPL или падает, есть ли признаки усталости.

### 4. Рекомендация на следующий тест
Конкретно: какие комбинации параметров тестировать следующими (на основе паттернов виннеров и незатестированных пространств). Формат P?·H?·B?·A?.

Пиши конкретно. Без воды. Не больше 500 слов.`;

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}
