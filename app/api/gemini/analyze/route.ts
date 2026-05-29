import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext } from "@/lib/brief";

export const maxDuration = 300; // 5 minutes for video processing

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const FILES_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";

const CONTEXT = `Контекст: рекламные креативы.\n\n${getAiContext()}`;

const SINGLE_PROMPT = `${CONTEXT}

Проанализируй этот рекламный креатив:

1. **Хук (первые 3 сек / первый экран)** — насколько цепляет? Оценка 1-10
2. **Релевантность аудитории** — попадает ли в боль иммигранта? Оценка 1-10
3. **Чёткость оффера** — понятно что предлагается? Есть CTA? Оценка 1-10
4. **Визуальное качество** — профессионализм, читаемость. Оценка 1-10
5. **Потенциал виннера** — ВЫСОКИЙ / СРЕДНИЙ / НИЗКИЙ + почему
6. **Сильные стороны** (2-3 пункта)
7. **Что улучшить** (2-3 конкретных предложения)

Отвечай на русском. Конкретно и практично.`;

const WINNER_PROMPT = `${CONTEXT}

Тебе показаны два креатива: первый — ВИННЕР (CPL ≤ €20), второй — ЛУЗЕР (CPL > €25).

Объясни ПОЧЕМУ ВИННЕР ПОБЕДИЛ:

1. **Ключевое отличие хука** — что виннер делает в первые 3 сек, чего нет у лузера?
2. **Попадание в боль** — как виннер формулирует проблему аудитории?
3. **Оффер и CTA** — чем убедительнее?
4. **Визуальные решения** — что работает в виннере?
5. **Формула виннера** — 3-5 конкретных принципа
6. **Что скопировать в следующий крео**

Отвечай на русском. Только actionable выводы.`;

const LOSER_PROMPT = `${CONTEXT}

Тебе показаны два креатива: первый — ВИННЕР (CPL ≤ €20), второй — ЛУЗЕР (CPL > €25).

Разбери ПОЧЕМУ ЛУЗЕР ПРОВАЛИЛСЯ:

1. **Слабый хук** — что не так в первые 3 сек?
2. **Промах по аудитории** — где лузер не попал в боль?
3. **Проблемы с оффером** — что непонятно или неубедительно?
4. **Визуальные ошибки** — что отталкивает?
5. **Корневые причины провала** — 3-5 конкретных ошибок
6. **Как исправить** — конкретные правки

Отвечай на русском. Только actionable выводы.`;

// Fetch file from URL into buffer
async function fetchBuffer(url: string): Promise<{ buffer: ArrayBuffer; mimeType: string; name: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file from storage: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await res.arrayBuffer();
  const name = url.split("/").pop()?.split("?")[0] ?? "file";
  return { buffer, mimeType, name };
}

// Upload file to Gemini Files API, return fileUri
async function uploadToFilesApi(buffer: ArrayBuffer, mimeType: string, displayName: string): Promise<string> {
  // Step 1: initiate resumable upload
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
  if (!uploadUrl) throw new Error("Не удалось инициировать загрузку файла в Gemini");

  // Step 2: upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Ошибка загрузки файла: ${err}`);
  }

  const uploadData = await uploadRes.json() as { file?: { uri?: string; name?: string; state?: string } };
  const fileInfo = uploadData.file;
  if (!fileInfo?.uri || !fileInfo?.name) throw new Error("Gemini Files API не вернул URI");

  // Poll until ACTIVE (videos need processing time)
  const fileName = fileInfo.name; // e.g. "files/abc123"
  for (let i = 0; i < 20; i++) {
    const stateRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`
    );
    const stateData = await stateRes.json() as { state?: string; uri?: string };
    if (stateData.state === "ACTIVE") return fileInfo.uri;
    if (stateData.state === "FAILED") throw new Error("Gemini отклонил файл (FAILED)");
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Файл не стал активным за 60 секунд");
}

async function urlToPart(url: string) {
  const { buffer, mimeType, name } = await fetchBuffer(url);
  const fileUri = await uploadToFilesApi(buffer, mimeType, name);
  return { file_data: { mime_type: mimeType, file_uri: fileUri } };
}

export async function POST(req: NextRequest) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY не настроен" }, { status: 500 });
  }

  let body: { mode?: string; fileUrl?: string; winnerUrl?: string; loserUrl?: string; fileName?: string; winnerName?: string; loserName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  const { mode: analysisMode = "single", fileUrl, winnerUrl, loserUrl, fileName, winnerName, loserName } = body;

  let prompt: string;
  let parts: unknown[];

  try {
    if (analysisMode === "single") {
      if (!fileUrl) return NextResponse.json({ error: "fileUrl обязателен" }, { status: 400 });
      prompt = SINGLE_PROMPT;
      parts = [{ text: prompt }, await urlToPart(fileUrl)];
    } else {
      if (!winnerUrl || !loserUrl) return NextResponse.json({ error: "Нужны оба URL: winnerUrl и loserUrl" }, { status: 400 });
      prompt = analysisMode === "winner" ? WINNER_PROMPT : LOSER_PROMPT;
      parts = [
        { text: prompt },
        { text: "ВИННЕР:" }, await urlToPart(winnerUrl),
        { text: "ЛУЗЕР:" }, await urlToPart(loserUrl),
      ];
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
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

  // Save analysis to DB
  const supabase = createServiceClient();
  await supabase.from("gemini_analyses").insert({
    mode: analysisMode,
    analysis: text,
    winner_name: winnerName ?? null,
    loser_name: loserName ?? null,
    file_name: fileName ?? null,
  });

  return NextResponse.json({ ok: true, analysis: text });
}
