// Генерация статичных креативов через Google Gemini image (nano-banana / Gemini 3 Pro Image).
// Возвращает байты картинки (Gemini отдаёт inline base64, синхронно — без поллинга).
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

interface InlinePart {
  inlineData?: { data?: string; mimeType?: string };
  inline_data?: { data?: string; mime_type?: string };
}

export async function generateCreativeImage(model: string, prompt: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as { candidates?: { content?: { parts?: InlinePart[] } }[] };
  for (const c of data.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      const inline = p.inlineData ?? p.inline_data;
      const b64 = inline?.data;
      if (b64) {
        const mimeType = (p.inlineData?.mimeType ?? p.inline_data?.mime_type) || "image/png";
        return { buffer: Buffer.from(b64, "base64"), mimeType };
      }
    }
  }
  throw new Error("Gemini не вернул изображение (возможно, сработал safety-фильтр)");
}
