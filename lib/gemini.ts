import { getAiContext } from "@/lib/brief";

// Переиспользуемые helpers для Gemini Vision (Files API) + резолв видео из Meta.
// Используется батч-разбором креативов (/api/gemini/batch).

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const FILES_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const META_TOKEN = process.env.META_ACCESS_TOKEN!;

// Структурное ОПИСАНИЕ креатива для аналитики (не оценки) — кормит контекст отчёта.
const DESC_PROMPT = `Контекст: рекламный креатив.\n\n${getAiContext()}

Опиши ЭТОТ креатив структурно и фактологически (для аналитики, НЕ маркетинговый текст, без оценок 1-10):
1. Формат/тип: видео или статика; UGC / студия / анимация / talking-head / интервью / квиз-карточка и т.п.
2. Хук (первые 3 сек или первый экран): что именно показано и сказано.
3. На какую боль/триггер аудитории давит.
4. Оффер и CTA.
5. Визуальный стиль и темп (динамика, монтаж).
6. Текст на экране / язык (если есть).
Кратко, 5-8 предложений, на русском. Только факты о содержании.`;

async function fetchBuffer(url: string): Promise<{ buffer: ArrayBuffer; mimeType: string; name: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch asset failed: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await res.arrayBuffer();
  const name = url.split("/").pop()?.split("?")[0] ?? "file";
  return { buffer, mimeType, name };
}

async function uploadToFilesApi(buffer: ArrayBuffer, mimeType: string, displayName: string): Promise<string> {
  const initRes = await fetch(`${FILES_API}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Files API: не удалось инициировать загрузку");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Type": mimeType },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`Files API upload: ${await uploadRes.text()}`);

  const uploadData = await uploadRes.json() as { file?: { uri?: string; name?: string } };
  const fileInfo = uploadData.file;
  if (!fileInfo?.uri || !fileInfo?.name) throw new Error("Files API не вернул URI");

  // Видео нужно время на обработку — ждём ACTIVE.
  for (let i = 0; i < 20; i++) {
    const stateRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${GEMINI_API_KEY}`);
    const stateData = await stateRes.json() as { state?: string };
    if (stateData.state === "ACTIVE") return fileInfo.uri;
    if (stateData.state === "FAILED") throw new Error("Gemini отклонил файл (FAILED)");
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Файл не стал ACTIVE за 60с");
}

// Резолв прямой ссылки на видео из Meta по video_id (временный CDN-URL).
export async function resolveMetaVideoSource(videoId: string): Promise<string | null> {
  if (!META_TOKEN) return null;
  const res = await fetch(`https://graph.facebook.com/v21.0/${videoId}?fields=source&access_token=${META_TOKEN}`);
  const json = await res.json() as { source?: string; error?: unknown };
  return json.source ?? null;
}

// Разбор одного креатива Gemini Vision → текстовое описание.
export async function describeCreative(assetUrl: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан");
  const { buffer, mimeType, name } = await fetchBuffer(assetUrl);
  const fileUri = await uploadToFilesApi(buffer, mimeType, name);
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: DESC_PROMPT }, { file_data: { mime_type: mimeType, file_uri: fileUri } }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini не вернул описание");
  return text;
}
