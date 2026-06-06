import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { Persona, Hook, Body, Angle, ConstructorSession, Scenario, Rule } from "@/lib/types";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext, getBusiness } from "@/lib/brief";

// 20 брифов × ~15-30 секунд каждый = до 10 минут.
// Hobby cap = 300s. Используем максимум; параллелизируем через batch чтобы уложиться.
export const maxDuration = 300;

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

  // Pack-mode: session создана через /api/pack/generate → берём готовые слоты.
  // Конвертируем коды P/H/B/A → uuids через библиотеку.
  const packMeta = (session as { packMetadata?: { slots: Array<{ codes: { persona: string | null; hook: string | null; body: string | null; angle: string | null } }> } }).packMetadata;
  if (packMeta?.slots?.length) {
    const codeToId = (rows: Array<{ id: string; code?: string | null }>) =>
      new Map(rows.filter(r => r.code).map(r => [r.code as string, r.id]));
    const pByCode = codeToId(personas);
    const hByCode = codeToId(hooks);
    const bByCode = codeToId(bodies);
    const aByCode = codeToId(angles);

    for (const slot of packMeta.slots) {
      const personaId = slot.codes.persona ? pByCode.get(slot.codes.persona) : undefined;
      const hookId    = slot.codes.hook    ? hByCode.get(slot.codes.hook)    : undefined;
      const bodyId    = slot.codes.body    ? bByCode.get(slot.codes.body)    : undefined;
      const angleId   = slot.codes.angle   ? aByCode.get(slot.codes.angle)   : undefined;
      if (!personaId || !hookId || !bodyId || !angleId) continue; // пропускаем неполный слот
      combinations.push({ personaId, hookId, bodyId, angleId });
    }
  } else {
    // Legacy mode: ручной матричный конструктор (декартово произведение).
    for (const pId of session.selectedPersonas)
      for (const hId of session.selectedHooks)
        for (const bId of session.selectedBodies)
          for (const aId of session.selectedAngles)
            combinations.push({ personaId: pId, hookId: hId, bodyId: bId, angleId: aId });
  }

  if (combinations.length === 0) {
    return new NextResponse(JSON.stringify({ error: "No combinations to generate. Session has neither pack_metadata.slots nor selected_* arrays." }), { status: 400 });
  }

  // Один бриф = один вызов. Анализ:
  //   при BATCH=4 → max_tokens=16k → реально 60-180с per batch и truncation.
  //   при BATCH=1 → max_tokens=6k → 20-30с per call, нет truncation.
  //   при concurrency=5 → 4 раунда × 30с = 120с — уверенно в Vercel 300s.
  const BATCH_SIZE = 1;
  const encoder = new TextEncoder();

  const batches: typeof combinations[] = [];
  for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
    batches.push(combinations.slice(i, i + BATCH_SIZE));
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let done = 0;
        // Запускаем все батчи параллельно
        const buildBatchPrompt = (batch: typeof combinations) => {
          const isVideo = session.format !== "static";
          return `Ты — копирайтер и режиссёр Meta Ads для ${getBusiness().name}.

${getAiContext()}

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
        };

        // Обработать один батч → выплюнуть все брифы в stream
        const processBatch = async (batch: typeof combinations, batchIdx: number) => {
          const t0 = Date.now();
          console.log(`[gen-briefs] batch ${batchIdx} START (${batch.length} combos)`);
          const msgStream = client.messages.stream({
            model: "claude-sonnet-4-6",
            // fullBrief нужно 4-6k tokens. Берём 8k с запасом, чтобы Claude
            // не обрезал scenario / shot plan / Higgsfield prompt mid-output.
            max_tokens: 8000,
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
            messages: [{ role: "user", content: buildBatchPrompt(batch) }],
          });

          const msg = await msgStream.finalMessage();
          console.log(`[gen-briefs] batch ${batchIdx} CLAUDE ok ${Date.now() - t0}ms`);
          const toolUse = msg.content.find(b => b.type === "tool_use") as { type: "tool_use"; input: { briefs: { idx: number; adaptedHook: string; adaptedBody: string; adaptedAngle: string; fullBrief: string }[] } } | undefined;
          const batchResults = toolUse?.input?.briefs ?? [];
          console.log(`[gen-briefs] batch ${batchIdx} GOT ${batchResults.length} briefs from Claude`);

          // Position-based: игнорируем result.idx (Claude может вернуть 1-based
          // или другой порядок — теряем брифы из-за неправильного индекса).
          // Доверяем порядку в массиве: batchResults[i] ← batch[i].
          for (let i = 0; i < batchResults.length; i++) {
            const combo = batch[i];
            const result = batchResults[i];
            if (!combo || !result) continue;
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
            controller.enqueue(encoder.encode(JSON.stringify(brief) + "\n"));
            done++;
            controller.enqueue(encoder.encode(JSON.stringify({ __progress: Math.round((done / combinations.length) * 100) }) + "\n"));
          }
        };

        // Concurrent с лимитом 4. С BATCH=1 — нагрузка per-call мала,
        // 4 параллельных уверенно не упираются в Anthropic TPM.
        const CONCURRENCY = 4;
        const errors: string[] = [];
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        const wrapped = async (batch: typeof combinations, idx: number) => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              // Hard timeout 90с на один Claude call — чтобы зависший
              // запрос не блокировал worker'а и не съедал maxDuration.
              await Promise.race([
                processBatch(batch, idx),
                new Promise<never>((_, rej) =>
                  setTimeout(() => rej(new Error(`per-call timeout 90s`)), 90_000)
                ),
              ]);
              return;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const isRateLimit = /429|rate.?limit|overload/i.test(msg);
              if (attempt < 3 && isRateLimit) {
                console.warn(`[gen-briefs] batch ${idx} attempt ${attempt} rate-limited, retry`);
                await sleep(2000 * attempt);
                continue;
              }
              console.error(`[gen-briefs] batch ${idx} failed (attempt ${attempt}):`, msg);
              errors.push(`batch ${idx}: ${msg}`);
              return;
            }
          }
        };
        // Простой semaphore без deps
        const queue = batches.map((b, i) => ({ batch: b, idx: i }));
        const workers = Array.from({ length: CONCURRENCY }, async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            await wrapped(item.batch, item.idx);
          }
        });
        await Promise.all(workers);

        if (errors.length > 0) {
          // Не throw — все успешные брифы уже отправлены клиенту.
          // Сообщаем об ошибках отдельным JSON-line с __warning.
          controller.enqueue(encoder.encode(JSON.stringify({
            __warning: `${errors.length} батч(ей) с ошибками: ${errors.join("; ")}`,
          }) + "\n"));
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
