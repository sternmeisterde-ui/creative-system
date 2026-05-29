import { NextResponse } from "next/server";

export const maxDuration = 120;
import { createServiceClient } from "@/lib/supabase";
import { getAiContext, getBusiness } from "@/lib/brief";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export async function POST() {
  const supabase = createServiceClient();

  const { data: analyses } = await supabase
    .from("gemini_analyses")
    .select("mode, analysis, winner_name, loser_name, file_name, created_at")
    .in("mode", ["winner", "loser"])
    .order("created_at", { ascending: false })
    .limit(30);

  if (!analyses || analyses.length === 0) {
    return NextResponse.json({ error: "Нет сохранённых анализов. Сначала проанализируй несколько пар виннер/лузер." }, { status: 400 });
  }

  const analysesText = analyses.map((a, i) => {
    const label = a.mode === "winner" ? "АНАЛИЗ ВИННЕРА" : "АНАЛИЗ ЛУЗЕРА";
    const files = a.winner_name ? `(${a.winner_name} vs ${a.loser_name})` : "";
    return `--- ${label} #${i + 1} ${files} ---\n${a.analysis}`;
  }).join("\n\n");

  const prompt = `Ты эксперт по рекламным креативам для ${getBusiness().name}.

${getAiContext()}

Ниже собраны ${analyses.length} анализов сравнений виннеров и лузеров, сделанных ранее:

${analysesText}

---

На основе ВСЕХ этих анализов составь исчерпывающий актуальный гайд:

## КАК СДЕЛАТЬ ВИННЕРА

### 1. Формула хука
Что работает в первые 3 секунды/первый экран? Конкретные паттерны.

### 2. Попадание в боль аудитории
Какие формулировки и триггеры стабильно работают?

### 3. Структура оффера
Что должно быть обязательно? Как формулировать CTA?

### 4. Визуальные принципы
Что работает визуально, что нет?

### 5. Частые ошибки лузеров
Топ ошибок которые убивают крео.

### 6. Чеклист перед запуском
5-7 конкретных вопросов которые нужно задать перед запуском крео.

Отвечай на русском. Только конкретика — никакой воды. Основывайся исключительно на данных из анализов выше.`;

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 10000 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Gemini error: ${err}` }, { status: 502 });
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return NextResponse.json({ error: "Gemini не вернул результат" }, { status: 502 });

  return NextResponse.json({ ok: true, recipe: text, analysesCount: analyses.length });
}
