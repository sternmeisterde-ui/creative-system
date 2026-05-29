import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { getAiContext, getBusiness } from "@/lib/brief";

export const maxDuration = 120;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { flow } = await req.json() as { flow?: string };
  const supabase = createServiceClient();
  const settings = await getSettings();
  const business = getBusiness();

  // 1. Данные из creative_performance
  let perfQuery = supabase
    .from("creative_performance")
    .select("ad_name, flow, auto_status, risk_signals, spend, impressions, cpl, cpql, ctr, leads, qual_leads, cr_lead_to_qual, roas, lifespan_days, age_days, is_active")
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

  const winners     = perfData.filter(r => r.auto_status === "winner");
  const fakeWinners = perfData.filter(r => r.auto_status === "fake_winner");
  const losers      = perfData.filter(r => r.auto_status === "loser");
  const testing     = perfData.filter(r => r.auto_status === "testing" && r.spend > 10);

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

  const RISK_LABEL: Record<string, string> = {
    low_qual_cr:   "низкая CR Lead→Qual (<60%)",
    short_lifespan: "короткий жизненный цикл (<7 дней)",
    low_roas_30d:  "ROAS<1 при возрасте ≥30 дней и spend≥€500",
  };
  const fmtRisk = (signals: unknown) => {
    const arr = Array.isArray(signals) ? signals as string[] : [];
    if (!arr.length) return "—";
    return arr.map(s => RISK_LABEL[s] ?? s).join(", ");
  };

  const prompt = `Ты — аналитик Meta Ads для ${business.name}.

${getAiContext()}

Цели: CPL ≤ €${settings.cplTarget}, CPQL ≤ €${settings.cpqlTarget}, порог значимости ${settings.minImpressionsForStatus.toLocaleString()} показов.${flow && flow !== "all" ? `\nПоток: ${flow.toUpperCase()}` : ""}

ВАЖНО: помимо «настоящих» виннеров есть **fake_winners** — объявления, прошедшие KPI по CPL/CPQL/impressions,
но имеющие проблемы внутри воронки или экономики. Это самая опасная категория: они выглядят как успех,
но реально съедают бюджет в минус. В анализе разделяй их явно.

## НАСТОЯЩИЕ ВИННЕРЫ (${winners.length} шт.)
${winners.length > 0
  ? winners.map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "—"} | CPQL €${r.cpql?.toFixed(1) ?? "—"} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"} | ${r.impressions?.toLocaleString()} показов`).join("\n")
  : "Виннеров нет."}

## ⚠️ FAKE WINNERS — опасные виннеры (${fakeWinners.length} шт.)
Прошли KPI, но имеют red flags. Перечисли каждого, обязательно укажи СИГНАЛЫ и сумму потраченного бюджета.
${fakeWinners.length > 0
  ? fakeWinners.slice(0, 15).map(r => `• ${r.ad_name} | spend €${r.spend?.toFixed(0)} | CPL €${r.cpl?.toFixed(1) ?? "—"} | CPQL €${r.cpql?.toFixed(1) ?? "—"} | CR ${r.cr_lead_to_qual?.toFixed(0) ?? "—"}% | ROAS ${r.roas?.toFixed(2) ?? "—"} | возраст ${r.age_days ?? "?"}д | lifespan ${r.lifespan_days ?? "?"}д | ⚑ ${fmtRisk(r.risk_signals)}`).join("\n")
  : "Опасных виннеров нет — хорошо."}

## ЛУЗЕРЫ (${losers.length} шт.)
${losers.length > 0
  ? losers.slice(0, 10).map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "—"} | €${r.spend?.toFixed(0)} спенд | ${r.impressions?.toLocaleString()} показов`).join("\n")
  : "Лузеров нет."}

## В ТЕСТЕ с данными (топ по спенду, ${testing.length} шт.)
${testing.slice(0, 10).map(r => `• ${r.ad_name} | CPL €${r.cpl?.toFixed(1) ?? "нет данных"} | €${r.spend?.toFixed(0)} спенд | ${r.leads ?? 0} лидов`).join("\n")}

## ТОП-5 ПО CPL (среди всех со статусом)
${top5cpl.map(r => `• ${r.ad_name}: CPL €${r.cpl?.toFixed(1)}, CPQL €${r.cpql?.toFixed(1) ?? "—"}, ${r.leads} лидов, €${r.spend?.toFixed(0)} спенд, статус: ${r.auto_status}`).join("\n") || "Нет данных."}

## ДИНАМИКА CPL ПО ДНЯМ (все объявления агрегировано)
${dailySummary || "Нет данных."}

---

Дай структурированный анализ на русском языке:

### 1. Что реально работает
Паттерны только из настоящих виннеров (без fake_winners). Что общего у них, какие параметры P/H/B/A.

### 2. ⚠️ Опасные виннеры — где замаскированы убытки
Разбери fake_winners по red flags. Какие конкретно объявления съедают бюджет с слабой воронкой/нулевым ROAS.
Назови топ-5 самых дорогих fake_winners с указанием сигнала и суммы потраченного бюджета.
Какие параметры (P/H/B/A) чаще всего в fake_winner-категории?

### 3. Что не работает
Паттерны лузеров — где сливается бюджет, какие параметры стабильно дают высокий CPL.

### 4. Тренд пака
Оценка по динамике последних 5 дней — растёт CPL или падает, есть ли признаки усталости.

### 5. Рекомендация на следующий тест
Конкретно: какие комбинации тестировать на основе настоящих виннеров (НЕ fake). Формат P?·H?·B?·A?.
Что точно НЕ повторять — параметры fake_winners.

Пиши конкретно, без воды. Не больше 600 слов.`;

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
