import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Persona, Hook, Body, Angle, ConstructorSession, Scenario, Rule } from "@/lib/types";
import { createServiceClient } from "@/lib/supabase";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { session, personas, hooks, bodies, angles, scenarios, rules } = await req.json() as {
    session: ConstructorSession;
    personas: Persona[];
    hooks: Hook[];
    bodies: Body[];
    angles: Angle[];
    scenarios: Scenario[];
    rules: Rule[];
  };

  const pMap = Object.fromEntries(personas.map(p => [p.id, p]));
  const hMap = Object.fromEntries(hooks.map(h => [h.id, h]));
  const bMap = Object.fromEntries(bodies.map(b => [b.id, b]));
  const aMap = Object.fromEntries(angles.map(a => [a.id, a]));
  const sMap: Record<string, string> = {};
  scenarios.forEach(s => { sMap[`${s.paramType}_${s.paramId}`] = s.content; });

  const activeRules = rules.filter(r => r.active);
  const rulesText = activeRules.length > 0
    ? `\nПРАВИЛА АДАПТАЦИИ:\n${activeRules.map((r, i) => `${i + 1}. ${r.title}: ${r.content}`).join("\n")}`
    : "";

  const supabase = createServiceClient();
  const { data: analyses } = await supabase
    .from("gemini_analyses")
    .select("mode, analysis")
    .in("mode", ["winner", "loser"])
    .order("created_at", { ascending: false })
    .limit(20);

  const winnerContext = analyses && analyses.length > 0
    ? `\nКОНТЕКСТ ИЗ АНАЛИЗА ВИННЕРОВ И ЛУЗЕРОВ (используй эти паттерны при генерации брифов):\n${analyses.map(a => `[${a.mode.toUpperCase()}]: ${a.analysis}`).join("\n\n---\n\n")}\n`
    : "";

  const combinations: { personaId: string; hookId: string; bodyId: string; angleId: string }[] = [];
  for (const pId of session.selectedPersonas)
    for (const hId of session.selectedHooks)
      for (const bId of session.selectedBodies)
        for (const aId of session.selectedAngles)
          combinations.push({ personaId: pId, hookId: hId, bodyId: bId, angleId: aId });

  const BATCH_SIZE = 2;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let done = 0;
        for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
          const batch = combinations.slice(i, i + BATCH_SIZE);

          const isVideo = session.format !== "static";
          const batchPrompt = `Ты — копирайтер и режиссёр Meta Ads для SternMeister (онлайн-курсы бухгалтерии для иммигрантов в Германии).
Формат объявления: ${session.format.toUpperCase()}${isVideo ? " (видео 15–30 сек)" : " (статичный баннер)"}.
${rulesText}${winnerContext}

Для каждой комбинации создай ПОЛНЫЙ ПАКЕТ: адаптированный контент + ${isVideo ? "покадровый сценарий с таймкодами + ТЗ на монтаж" : "описание баннера + ТЗ на дизайн"} + промпт для Higgsfield.

${batch.map((combo, idx) => {
  const persona = pMap[combo.personaId];
  const hook = hMap[combo.hookId];
  const body = bMap[combo.bodyId];
  const angle = aMap[combo.angleId];
  return `КОМБИНАЦИЯ ${idx + 1}:
Персона: ${persona?.name} (${persona?.gender || "?"}, ${persona?.age || "?"}). ${persona?.description || ""}${persona?.pointA ? ` Точка А: ${persona.pointA}` : ""}${persona?.pointB ? ` Точка Б: ${persona.pointB}` : ""}
Хук: ${hook?.name}. Базовый сценарий: "${sMap[`hook_${combo.hookId}`] || hook?.template || ""}"
Боди: ${body?.name}. Базовый сценарий: "${sMap[`body_${combo.bodyId}`] || body?.template || ""}"
Энгл: ${angle?.name}. Базовый сценарий: "${sMap[`angle_${combo.angleId}`] || angle?.template || ""}"`;
}).join("\n\n")}

Для fullBrief используй СТРОГО этот формат (секции разделены ---):

${isVideo ? `## СЦЕНАРИЙ
[Адаптированный текст объявления целиком — от первого лица для UGC, плавно от хука к боди к энглу к CTA]

---

## ПОКАДРОВЫЙ ПЛАН
[0:00–0:03] ХУКОВЫЙ КАДР: [описание кадра, что происходит, что говорит персонаж]
[0:03–0:08] РАЗВИТИЕ: [следующий кадр]
[0:08–0:15] БОДИ / ОФФЕР: [кадр с сутью]
[0:15–0:22] ДОКАЗАТЕЛЬСТВО: [кадр]
[0:22–0:28] CTA: [финальный призыв, что видит зритель]

---

## ТЗ НА МОНТАЖ
Ритм: [быстрый / средний / медленный]
Музыка: [описание стиля/настроения]
Текстовые оверлеи: [что и когда показывать на экране]
Субтитры: [нужны / не нужны, стиль]
Переходы: [описание]
Цветокоррекция: [теплая / холодная / нейтральная + почему]

---

## ПРОМПТ ДЛЯ HIGGSFIELD
[Готовый промпт на английском для text-to-video, 2–4 предложения: стиль, действие персонажа, атмосфера, камера]` : `## ОПИСАНИЕ БАННЕРА
[Адаптированный заголовок, подзаголовок, основной текст, CTA-кнопка]

---

## ТЗ НА ДИЗАЙН
Фон: [описание]
Главный визуал: [что изображено]
Заголовок: [текст + размер + расположение]
Цветовая схема: [цвета + hex если нужно]
CTA-кнопка: [текст + цвет]
Дополнительно: [логотип, доп. элементы]

---

## ПРОМПТ ДЛЯ HIGGSFIELD
[Готовый промпт на английском для text-to-image, 2–3 предложения: стиль, визуал, настроение]`}`;

          const msgStream = client.messages.stream({
            model: "claude-opus-4-6",
            max_tokens: 32000,
            tools: [{
              name: "generate_briefs",
              description: "Сгенерировать адаптированные брифы для каждой комбинации",
              input_schema: {
                type: "object" as const,
                properties: {
                  briefs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        idx: { type: "number" },
                        adaptedHook: { type: "string" },
                        adaptedBody: { type: "string" },
                        adaptedAngle: { type: "string" },
                        fullBrief: { type: "string" },
                      },
                      required: ["idx", "adaptedHook", "adaptedBody", "adaptedAngle", "fullBrief"],
                    },
                  },
                },
                required: ["briefs"],
              },
            }],
            tool_choice: { type: "tool", name: "generate_briefs" },
            messages: [{ role: "user", content: batchPrompt }],
          });

          const msg = await msgStream.finalMessage();
          const toolUse = msg.content.find(b => b.type === "tool_use") as { type: "tool_use"; input: { briefs: { idx: number; adaptedHook: string; adaptedBody: string; adaptedAngle: string; fullBrief: string }[] } } | undefined;
          const batchResults = toolUse?.input?.briefs ?? [];

          for (const result of batchResults) {
            const combo = batch[result.idx];
            if (!combo) continue;
            const brief = {
              personaId: combo.personaId,
              hookId: combo.hookId,
              bodyId: combo.bodyId,
              angleId: combo.angleId,
              format: session.format,
              adaptedHook: result.adaptedHook,
              adaptedBody: result.adaptedBody,
              adaptedAngle: result.adaptedAngle,
              fullBrief: result.fullBrief,
            };
            // Send each brief as a newline-delimited JSON line
            controller.enqueue(encoder.encode(JSON.stringify(brief) + "\n"));
            done++;
          }

          // Send progress
          controller.enqueue(encoder.encode(JSON.stringify({ __progress: Math.round((done / combinations.length) * 100) }) + "\n"));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ __error: e instanceof Error ? e.message : String(e) }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
