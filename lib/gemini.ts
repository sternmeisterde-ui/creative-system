import { getAiContext } from "@/lib/brief";

// Переиспользуемые helpers для Gemini Vision (Files API) + резолв видео из Meta.
// Используется батч-разбором креативов (/api/gemini/batch).

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const FILES_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const META_TOKEN = process.env.META_ACCESS_TOKEN!;

// Структурное ОПИСАНИЕ креатива для аналитики (не оценки) — кормит контекст отчёта.
const DESC_PROMPT = `Контекст: рекламный креатив.\n\n${getAiContext()}

Опиши ЭТОТ креатив МАКСИМАЛЬНО ПОДРОБНО и фактологически — так, чтобы по описанию можно было ВОСПРОИЗВЕСТИ исполнение (для размножения виннеров). Без оценок 1-10, без маркетинга, только факты о содержании.

1. ФОРМАТ/ТИП: видео или статика; UGC / студия / анимация / talking-head / интервью / квиз-карточка / скринкаст и т.п.
2. ПЕРСОНАЖ/СПИКЕР (если есть): пол, примерный возраст, этничность и внешность, одежда, эмоция, манера речи; РЕАЛЬНЫЙ человек или AI-сгенерированный/синтетический. Фиксируй точно — это часто и есть причина успеха.
3. СЦЕНА/ЛОКАЦИЯ: где происходит, фон, предметы, освещение, цветовая гамма.
4. ЧТО ПРОИСХОДИТ: для ВИДЕО — по сценам/таймингу (начало/середина/конец, действия, смена планов, движение камеры); для СТАТИКИ — композиция (что вверху/центре/внизу).
5. ХУК (первые 3 сек / первый экран): дословно что показано и сказано.
6. ТЕКСТ НА ЭКРАНЕ / РЕЧЬ: ключевые фразы дословно, язык.
7. ОФФЕР И CTA.
8. БОЛЬ/ТРИГГЕР аудитории.
9. ВИЗУАЛЬНЫЙ СТИЛЬ И ТЕМП: монтаж, динамика, общее впечатление.

На русском, подробно (10-15 предложений). Никаких догадок о метриках.`;

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

// Page access token (кешируем): рекламные видео — это Reels страницы, и source
// отдаётся только PAGE-токеном (не system-user токеном). Страница назначена системному
// пользователю → токен страницы получаем из me/accounts.
let _pageToken: string | null = null;
async function getPageToken(): Promise<string | null> {
  if (_pageToken) return _pageToken;
  if (!META_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=access_token&access_token=${META_TOKEN}`);
    const j = await res.json() as { data?: { access_token?: string }[] };
    _pageToken = j.data?.[0]?.access_token ?? null;
  } catch { _pageToken = null; }
  return _pageToken;
}

// Резолв прямой ссылки на видео (.mp4) из Meta по video_id (временный CDN-URL).
export async function resolveMetaVideoSource(videoId: string): Promise<string | null> {
  if (!META_TOKEN) return null;
  const token = (await getPageToken()) ?? META_TOKEN; // page-токен открывает source у Reels
  const res = await fetch(`https://graph.facebook.com/v21.0/${videoId}?fields=source&access_token=${token}`);
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
      // На видео gemini-2.5-flash тратит много на "thinking" → даём большой бюджет и
      // отключаем thinking, чтобы output не обрезался на 1-й секции (был баг: 270 симв).
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini не вернул описание");
  return text;
}
