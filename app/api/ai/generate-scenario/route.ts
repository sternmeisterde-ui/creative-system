import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { brief, getAiContext } from "@/lib/brief";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Правила транслитерации/произношения для диалогов из brief.brand_voice.dialogue_rules.
// Сюда попадают вещи вроде «SternMeister → ШтернМастер», «DATEV → дАтэв» и т.д.
// Если в brief они не заданы — секция в промптах опускается.
const DIALOGUE_RULES = brief.brand_voice.dialogue_rules ?? [];
const DIALOGUE_RULES_BLOCK = DIALOGUE_RULES.length > 0
  ? `\nПРАВИЛА ДИАЛОГОВ (особенности произношения / транслитерации):\n${DIALOGUE_RULES.map(r => `  • ${r}`).join("\n")}\n`
  : "";
// Короткий inline-маркер для placeholder'ов внутри длинных промптов
const DIALOGUE_INLINE_HINT = DIALOGUE_RULES.length > 0
  ? `соблюдая правила: ${DIALOGUE_RULES.map(r => r.split(/[—:]|\(/)[0].trim()).join("; ")}`
  : "без правил транслитерации";

const TYPE_INSTRUCTIONS: Record<string, string> = {
  persona: `Ты пишешь ПРОФИЛЬ ПЕРСОНЫ для рекламного сценария.
Выдай:
1. ГОЛОС И ТОН — как говорит эта персона (2-3 предложения от первого лица)
2. КЛЮЧЕВЫЕ ФРАЗЫ — 5-7 фраз, которыми она описывает свою ситуацию (дословно, как в разговоре)
3. ГЛАВНЫЕ ТРИГГЕРЫ — 3 конкретных момента, которые заставляют её действовать
4. ГЛАВНЫЕ СТРАХИ — 3 конкретных барьера, которые останавливают
5. ПРИМЕР МОНОЛОГА — 4-6 предложений от первого лица, как она могла бы рассказать о своей ситуации в рекламе`,

  hook: `Ты пишешь ХУКОВЫЙ СЦЕНАРИЙ — первые 1-3 секунды рекламного видео или статики.
Выдай:
1. ХУКИ x5 — 5 вариантов первых 1-3 секунд (что видит зритель + что слышит/читает)
2. ЛУЧШИЙ ХУК — выдели лучший и объясни почему (1 предложение)
3. ВИЗУАЛЬНЫЙ КОД — детальное описание картинки для дизайнера/оператора
4. СТОП-СКРОЛЛ ЭЛЕМЕНТ — что именно заставит остановить прокрутку без звука`,

  body: `Ты пишешь БОДИ-СЦЕНАРИЙ — основную часть рекламного видео (секунды 3-35).
Выдай:
1. СТРУКТУРА СЦЕНЫ — покадровый план с таймкодами (0:03 — ..., 0:10 — ..., 0:25 — ..., 0:35 — ...)
2. ТЕКСТ НА ЭКРАНЕ — точные фразы, которые появляются на экране
3. ЗАКАДРОВЫЙ ТЕКСТ / МОНОЛОГ — полный текст озвучки или субтитров
4. ПЕРЕХОД К CTA — последние 5 секунд: как переходим к призыву`,

  angle: `Ты пишешь УГЛОВОЙ СЦЕНАРИЙ — как применить этот конкретный рекламный угол.
Выдай:
1. CORE MESSAGE — главное послание в 1 предложении (то, что должно остаться в голове)
2. ФОРМУЛИРОВКИ x5 — 5 конкретных версий этого посла (разные форматы: вопрос, утверждение, факт, история, провокация)
3. ДОКАЗАТЕЛЬСТВА — 3 конкретных факта/цифры/истории, которые подтверждают угол
4. РИСКИ — что НЕ говорить с этим углом (1-2 ошибки)`,
};

// ─── PRODUCTION RULES embedded from the team's video creation tutorial ────────
// Stack: Nano Banana Pro (photos) → Veo 3.1 fast/quality (video + voice)
// Edit: Premiere Pro. Subtitles added in post (SF Pro Semibold 84pt, black stroke 5).
// iPhone aesthetic throughout: no gimbal, no LUT, natural grain, handheld micro-shake.
// Dialogue rules: загружаются из brief.brand_voice.dialogue_rules (если заданы).
// Same character appearance + voice in EVERY prompt. No text/overlays in video.
// ──────────────────────────────────────────────────────────────────────────────

const VIDEO_PROMPT_FORMAT_RULES = `
ВАЖНЕЙШИЕ ПРАВИЛА ДЛЯ ПРОМПТОВ:
- Эстетика: снято на iPhone 15 Pro Max, без gimbal, без LUT, без cinematic grading, видимый natural grain, вертикаль 9:16
- Субтитры и текст: вообще не упоминать в промпте (добавляются на постпродакшене)
- Один персонаж: внешность, одежда и тембр голоса идентичны во ВСЕХ сценах
- Диалоги на языке аудитории, без тире, без экранных субтитров${DIALOGUE_RULES_BLOCK ? "\n" + DIALOGUE_RULES.map(r => `  • ${r}`).join("\n") : ""}
- Photo model: Nano Banana Pro
- Video model: Veo 3.1 fast (quality — если дефекты в речи или движениях)

ФОРМАТ ФОТО-ПРОМПТА (Nano Banana Pro):
Prompt: Hyper-realistic UGC-style [shot type] of [detailed character description]...
Camera & Settings: iPhone 15 Pro Max, 26mm equivalent lens, ISO [X], f/1.8 natural aperture simulation, 1/[X]s, natural iPhone color science, no Portrait mode, no computational blur, natural digital grain...
Lighting & Mood: [specific light source, color temp, mood]
Skin Realism: fully visible pores, natural texture, age lines unretouched, no retouching no smoothing
Hair & Fabric: [specific details]
[Background & Environment: if needed]
Post-processing: zero color grading, pure native iPhone color rendering, zero LUT, zero film emulation

ФОРМАТ ВИДЕО-ПРОМПТА (Veo 3.1):
Subject: [same Slavic/Eastern European character, 15+ physical attributes identical to all previous scenes — age, face, hair, clothing, posture. Voice: same vocal timbre throughout all scenes — [describe once: pitch, texture, pacing]. Emotional register in THIS scene: [specific for this scene]]
Action: [clip starts immediately, no silence, specific actions and micro-expressions, timing]
Scene: [environment, props, lighting — detailed]
Style: [shot type], camera at [angle]. Natural handheld iPhone micro-shake — no gimbal, no stabilization. Vertical aspect ratio 9:16. iPhone natural color science, [lighting conditions], no cinematic LUT, no film grade.
Dialogue: (Character): "[exact dialogue line on audience language, no dashes, ${DIALOGUE_INLINE_HINT}]" (Tone: [delivery style])
Sounds: [specific ambient audio, no music unless specified]
Technical (Negative Prompt): No subtitles, no captions, no text overlays of any kind, no watermarks, no on-screen graphics, no cinematic color grading, no gimbal-smooth camera movement, no beauty retouching, no skin smoothing filter, [scene-specific negatives]`;

const TZ_INSTRUCTIONS: Record<string, Record<string, string>> = {
  video: {
    persona: `## CHARACTER BIBLE (используется во всех промптах)

Сгенерируй детальное описание персонажа для поддержания визуальной и голосовой консистентности во всех сценах. Это описание вставляется в поле Subject каждого видео-промпта без изменений.

### ВНЕШНОСТЬ (для Subject в каждом промпте)
Пол и возраст: [конкретно — например "Slavic woman approximately 47 years old"]
Черты лица: [15+ атрибутов — скулы, нос, форма глаз, цвет, тёмные круги или нет, линии усталости, тип кожи]
Волосы: [длина, цвет, укладка — точно, не "каштановые", а "dark brown hair pulled into a slightly disheveled ponytail"]
Телосложение: [рост/телосложение + осанка — как несёт себя в ЭТОЙ сцене]

### ГОЛОС (неизменен во всех сценах — копируй дословно в каждый промпт)
Voice: [pitch, timbre, пacing — например: "steady, low-to-medium pitch with a slightly husky, dry timbre from fatigue — conversational but heavy, like a private confession forced into the open. Tempo is measured and deliberate. This tonal quality and vocal timbre remain completely unchanged across all scenes of this creative."]

### ОДЕЖДА ПО СЦЕНАМ (меняется):
Сцена 1 (хук/боль): [конкретная одежда под ситуацию — рабочая форма, усталость и т.п.]
Сцена 2+: [одежда по сценарию — трансформация образа]
Финал/CTA: [самый личный образ]

${VIDEO_PROMPT_FORMAT_RULES}`,

    hook: `## ТЗ: ПРОМПТЫ ДЛЯ ХУКА (Сцена 1, 0:00–0:03)

Сгенерируй два готовых к использованию промпта для первой сцены (хук) — ровно в формате ниже.

---

📸 PHOTO PROMPT — Сцена 1 (Hook) [для Nano Banana Pro]
Prompt: Hyper-realistic UGC-style [extreme close-up / medium shot] of [полное описание персонажа: пол, возраст, усталость/эмоция, конкретная одежда, причёска, выражение лица — не менее 10 деталей]. Shot handheld on iPhone. [Локация и фон — конкретно].
Camera & Settings: iPhone 15 Pro Max, 26mm equivalent lens, ISO [X], f/1.8 natural aperture simulation, 1/[X]s, natural iPhone color science, no Portrait mode, no computational blur, natural digital grain, slight handheld micro-shake.
Lighting & Mood: [конкретный источник света, цвет, направление, настроение — например "harsh overhead fluorescent tube lighting, cold greenish cast, institutional"]
Skin Realism: fully visible skin pores, natural texture, age lines unretouched, no retouching, no smoothing, no filters.
Hair & Fabric: [детали волос и одежды]
Post-processing: zero color grading, pure native iPhone color rendering, zero LUT, zero film emulation, natural grain.

---

🎬 VIDEO PROMPT — Сцена 1 (Hook) [для Veo 3.1]
Subject: [полное описание персонажа идентичное фото — те же черты лица, та же одежда, та же осанка. Voice: [тембр голоса — устойчивое описание для ВСЕХ сцен, например: "steady low-pitch, slightly husky and dry — measured, heavy, like a private confession. This vocal timbre remains completely unchanged across all scenes."]. Emotional register: [raw, exhausted confession / sharp direct accusation / quiet shame — конкретно под этот хук]]
Action: [клип начинается немедленно без паузы. Конкретные действия в первую секунду — что делает, микровыражения, темп. Нет театральности.]
Scene: [детальная среда — где происходит, что в фоне, реквизит, освещение]
Style: [Extreme close-up / Medium shot], camera at [direct eye level / slightly below]. Natural handheld iPhone micro-shake — no gimbal, no stabilization. Vertical aspect ratio 9:16. iPhone natural color science, [условия освещения], no cinematic LUT, no film grade.
Dialogue: (Character): "[точная реплика хука без тире${DIALOGUE_RULES.length > 0 ? ", соблюдая правила транслитерации из брифа" : ""}]" (Tone: [эмоциональный дескриптор доставки])
Sounds: [конкретные фоновые звуки — например "constant low-frequency hum of fluorescent lighting, distant supermarket ambient"]
Technical (Negative Prompt): No subtitles, no captions, no text overlays of any kind, no watermarks, no on-screen graphics, no cinematic color grading, no gimbal-smooth camera movement, no beauty retouching, no skin smoothing filter, no styled hair, no heavy makeup, [дополнительные запреты под эту сцену]

${VIDEO_PROMPT_FORMAT_RULES}`,

    body: `## ТЗ: ПРОМПТЫ ДЛЯ БОДИ + CTA (Сцены 2–6)

Сгенерируй два готовых промпта (фото + видео) для КАЖДОЙ сцены боди и CTA. Персонаж тот же что в хуке, одежда меняется по сценарию (трансформация).

Формат для каждой сцены:

---
### СЦЕНА [N] — [НАЗВАНИЕ] ([таймкод])

📸 PHOTO PROMPT — Сцена [N] [для Nano Banana Pro]
Prompt: Hyper-realistic UGC-style [shot type] of the same [пол/возраст] — identical appearance to [предыдущая сцена]: [черты лица, волосы]. Now wearing [одежда этой сцены]. [Поза и эмоция этой сцены]. [Детали локации и фона].
Camera & Settings: iPhone 15 Pro Max, 26mm equivalent lens, ISO [X], f/1.8 natural aperture, 1/[X]s, natural iPhone color science, no Portrait mode, no computational blur, natural digital grain.
Lighting & Mood: [источник, температура, настроение]
Skin Realism: same natural skin texture as all previous scenes — pores visible, age lines unretouched, no retouching.
Hair & Fabric: [детали]
[Background & Environment: если нужно]
Post-processing: iPhone natural color grade under [условие освещения] — [описание], zero LUT, zero film emulation.

🎬 VIDEO PROMPT — Сцена [N] [для Veo 3.1]
Subject: The same [пол/возраст] — identical face, bone structure, age lines, and natural skin texture as all previous scenes. [Одежда этой сцены]. [Осанка и состояние]. Voice: [ТОЧНО ТО ЖЕ описание тембра что в Сцене 1 — не сокращать]. Emotional register: [специфика для этой сцены]
Action: [клип начинается немедленно. Конкретные действия, длительность кадра, ключевые моменты]
Scene: [среда, реквизит, освещение]
Style: [тип кадра], camera at [угол]. Natural handheld iPhone micro-shake — no gimbal. Vertical aspect ratio 9:16. iPhone natural color science, [условие освещения], no cinematic LUT, no film grade.
Dialogue: (Character): "[реплика без тире${DIALOGUE_RULES.length > 0 ? ", по правилам брифа" : ""}]" (Tone: [дескриптор])
Sounds: [конкретный ambient]
Technical (Negative Prompt): No subtitles, no captions, no text overlays of any kind, no watermarks, no on-screen graphics, no cinematic color grading, no gimbal-smooth camera movement, no beauty retouching, no skin smoothing, [специфичные запреты для этой сцены]

---
[повторить для всех сцен боди и CTA]

МОНТАЖНЫЕ ЗАМЕТКИ:
- Субтитры в Premiere Pro: SF Pro Semibold, размер 84, чёрная обводка 5
- Заголовки: тот же шрифт, все буквы КАПС, размер 40
- Переходы: резкие склейки (hard cuts), убирать молчание на концах
- Акценты: ключевые слова выделять жёлтым

${VIDEO_PROMPT_FORMAT_RULES}`,

    angle: `## ТЗ НА ВИЗУАЛЬНЫЙ ЯЗЫК И АТМОСФЕРУ

### Общая эмоциональная дуга видео
Начало → середина → конец: [как меняется настроение — например "институциональная подавленность → открытие → тихая уверенность"]

### Монтажный ритм
[быстрый (1-2 сек на кадр) / средний (3-5 сек) / медленный — и почему под этот угол]

### Цветовой нарратив по сценам
Сцены боли: [холодный флуоресцентный / тёплый тусклый — что передаёт угнетение]
Сцены трансформации: [как меняется цветовая температура — например "тёплый настольный свет, dual-light экрана"]
CTA: [самый интимный и тёплый кадр]
Всё — iPhone native, zero LUT, изменение только через реальный свет в кадре.

### Ключевой визуальный момент
[Один кадр / секунда, которая должна остаться в памяти — конкретно]

### Что НЕ делать
[Запреты под этот конкретный угол — например "никаких таймлапсов скоростного монтажа, этот угол требует веса и паузы"]`,
  },
  static: {
    persona: `## ТЗ НА ДИЗАЙН (ПЕРСОНА)
Нужен ли образ персонажа на баннере: [да — фото / иллюстрация / нет]
Типаж на фото: [если да — конкретное описание человека]
Эмоция/Поза: [что выражает — усталость/надежда/уверенность, как стоит/сидит]
Стиль изображения: [реалистичное фото / нейтральный фон / в среде (на рабочем месте и т.п.)]`,

    hook: `## ТЗ НА ДИЗАЙН БАННЕРА (ХУК)
Форматы: [1:1 / 9:16 / 1.91:1 — или все три]
Главный заголовок: [точный текст хука — то, что читается первым]
Расположение заголовка: [сверху / снизу / по центру / поверх фото]
Шрифт заголовка: [крупный жирный / рукописный / строгий sans-serif — и размер относительно баннера]
Акцентное слово: [какое слово выделить цветом или размером]
Визуальный герой: [что главное на баннере — лицо человека / иконка / фон / текст]
Фон: [цвет (#hex если важно) / градиент / фото — описание]
Стоп-скролл элемент: [что зацепит взгляд — контраст / необычный цвет / крупное число / лицо]`,

    body: `## ТЗ НА ДИЗАЙН (БОДИ — основной блок)
Структура баннера (сверху вниз):
  1. [блок 1 — что написано, размер, цвет]
  2. [блок 2]
  3. [блок 3]
Буллиты/Список: [нужны ли, что перечислять, иконки или дефисы]
Социальное доказательство: [цифры / отзыв / логотип — как оформить]
Фоновый цвет зоны боди: [цвет или фото]
Шрифт боди: [размер, жирность, межстрочный интервал — крупнее среднего или нет]`,

    angle: `## ТЗ НА ДИЗАЙН (ЭНГЛ — визуальный угол)
Визуальная метафора: [как этот угол показать картинкой — конкретная идея]
Цветовая схема: [основные 2-3 цвета, почему они передают угол]
Ключевое изображение: [что стоит в центре — человек / объект / число / абстракция]
Настроение дизайна: [строгий / тёплый / тревожный / вдохновляющий]
Что НЕ делать: [конкретный запрет для этого угла]`,
  },
};

export async function POST(req: NextRequest) {
  const { type, item, sessionContext, format } = await req.json();

  const typeInstruction = TYPE_INSTRUCTIONS[type] || TYPE_INSTRUCTIONS.hook;
  const isVideo = format && format !== "static";
  const tzFormatKey = isVideo ? "video" : "static";
  const tzInstruction = TZ_INSTRUCTIONS[tzFormatKey]?.[type] ?? "";

  const contextBlock = sessionContext
    ? `\n\nКОНТЕКСТ СЕССИИ (другие выбранные параметры):\n${sessionContext}`
    : "";

  const supabase = createServiceClient();
  const { data: analyses } = await supabase
    .from("gemini_analyses")
    .select("mode, analysis")
    .in("mode", ["winner", "loser"])
    .order("created_at", { ascending: false })
    .limit(15);

  const winnerContext = analyses && analyses.length > 0
    ? `\nПАТТЕРНЫ ВИННЕРОВ И ЛУЗЕРОВ (учитывай при написании сценария):\n${analyses.map(a => `[${a.mode.toUpperCase()}]: ${a.analysis}`).join("\n\n---\n\n")}\n`
    : "";

  const formatLabel = format ? `Формат рекламы: ${format.toUpperCase()}${isVideo ? " (видео 15–35 сек)" : " (статичный баннер)"}` : "";

  const prompt = `Ты — эксперт по рекламным сценариям для Meta Ads (Facebook/Instagram).

${getAiContext()}
${DIALOGUE_RULES_BLOCK}
${formatLabel}

ПАРАМЕТР: ${type.toUpperCase()}
Название: ${item.name}
${item.description ? `Описание: ${item.description}` : ""}
${item.template ? `Шаблон: ${item.template}` : ""}
${item.examples?.length ? `Примеры: ${item.examples.join(" / ")}` : ""}
${item.pains?.length ? `Боли персоны: ${item.pains.join("; ")}` : ""}
${item.triggers?.length ? `Триггеры: ${item.triggers.join("; ")}` : ""}
${item.pointA ? `Точка А: ${item.pointA}` : ""}
${item.pointB ? `Точка Б: ${item.pointB}` : ""}${contextBlock}
${winnerContext}
${typeInstruction}

Будь конкретным. Используй живой язык аудитории. Никакой воды и шаблонных фраз.
${tzInstruction ? `\nПосле сценария напиши точно следующую строку-разделитель (ничего больше на этой строке):

===ТЗ===

Затем заполни ТЗ по следующей структуре — конкретно, без скобок-заглушек:

${tzInstruction}` : ""}`;

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 10000,
    thinking: { type: "enabled", budget_tokens: 8000 },
    messages: [{ role: "user", content: prompt }],
  });

  const readableStream = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(new TextEncoder().encode(event.delta.text));
        }
        // thinking_delta events are silently skipped — model thinks, we stream only text
      }
      controller.close();
    },
  });

  return new Response(readableStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
