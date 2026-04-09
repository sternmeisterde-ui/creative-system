import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { concepts } = await req.json();

  if (!concepts || concepts.length === 0) {
    return NextResponse.json({ error: "No concepts provided" }, { status: 400 });
  }

  const prompt = `Ты — стратег по рекламным креативам Meta Ads. Проанализируй паттерны из рекламы конкурентов и сформулируй конкретные гипотезы для тестирования.

ПРОДУКТ: SternMeister — курсы бухгалтерии для русскоязычных иммигрантов в Германии.
АУДИТОРИЯ: Иммигранты 28–50 лет, работают не по специальности.
ЦЕЛЬ: Запись на бесплатную консультацию.

ОДОБРЕННЫЕ ПАТТЕРНЫ ОТ КОНКУРЕНТОВ (${concepts.length} шт.):
${concepts.map((c: { conceptType: string; title: string; description?: string }, i: number) => `
${i + 1}. [${c.conceptType?.toUpperCase() ?? "?"}] ${c.title}
${c.description ? `   Детали: ${c.description}` : ""}`).join("\n")}

На основе этих паттернов сформулируй:

1. ТОП-3 ГИПОТЕЗЫ ДЛЯ ХУКОВ — что именно попробовать в первых 3 секундах
2. ТОП-2 ГИПОТЕЗЫ ДЛЯ УГЛОВ ПОДАЧИ — какой messaging тестировать
3. ТОП-2 ГИПОТЕЗЫ ДЛЯ ПЕРСОН — какой сегмент аудитории попробовать по-новому
4. ФОРМАТЫ — какие визуальные форматы стоит протестировать
5. ПРИОРИТЕТ — с чего начать и почему (1 абзац)

Будь конкретным. Каждая гипотеза = одно ясное утверждение + почему должно работать (1-2 предложения).`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const hypothesis = (msg.content[0] as { type: string; text: string }).text;
  return NextResponse.json({ ok: true, hypothesis });
}
