// Генерация статичных креативов через Google Gemini image (nano-banana / Gemini 3 Pro Image).
// Возвращает байты картинки (Gemini отдаёт inline base64, синхронно — без поллинга).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  inline_data?: { data?: string; mime_type?: string };
}

// Аспект-ратио задаём ЯВНО через imageConfig.aspectRatio — текст промта («1080x1350»)
// Gemini как соотношение сторон НЕ соблюдает. Все статичные крео — 4:5 (вертикаль под ленту).
const STATIC_ASPECT_RATIO = "4:5";

async function tryGenerate(model: string, prompt: string, aspectRatio: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { candidates?: { content?: { parts?: InlinePart[] } }[] };
  for (const c of data.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const mimeType = (p.inlineData?.mimeType ?? p.inline_data?.mime_type) || "image/png";
        return { buffer: Buffer.from(inline.data, "base64"), mimeType };
      }
    }
  }
  return null; // модель вернула ответ без картинки (бывает у nano-banana) — ретраим
}

export async function generateCreativeImage(model: string, prompt: string, aspectRatio: string = STATIC_ASPECT_RATIO): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан");
  // nano-banana периодически отдаёт ответ без изображения — до 4 попыток.
  for (let attempt = 0; attempt < 4; attempt++) {
    const out = await tryGenerate(model, prompt, aspectRatio);
    if (out) return out;
  }
  throw new Error("Gemini не вернул изображение за 4 попытки (вероятно safety-фильтр или сложный промт)");
}
