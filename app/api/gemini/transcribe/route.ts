import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { resolveMetaVideoSource, transcribeCreative } from "@/lib/gemini";

// Дословная транскрибация видео-крео (для ручной разметки хуков).
// Body: { adNames: string[] }. Для каждого: meta_creatives.video_id → source (page-токен)
// → Gemini transcribe → gemini_analyses(mode='transcript', ad_name). Последовательно (видео тяжёлые).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { adNames } = await req.json().catch(() => ({})) as { adNames?: string[] };
  if (!adNames?.length) return NextResponse.json({ error: "adNames required" }, { status: 400 });

  const sb = createServiceClient();
  const results: { ad_name: string; ok: boolean; chars?: number; note?: string }[] = [];

  for (const ad_name of adNames) {
    try {
      const { data: cre } = await sb.from("meta_creatives")
        .select("video_id, object_type").eq("ad_name", ad_name).not("video_id", "is", null).limit(1).maybeSingle();
      if (!cre?.video_id) { results.push({ ad_name, ok: false, note: "нет video_id в meta_creatives" }); continue; }

      const source = await resolveMetaVideoSource(String(cre.video_id));
      if (!source) { results.push({ ad_name, ok: false, note: "не удалось получить source видео" }); continue; }

      const transcript = await transcribeCreative(source);

      // Перезапись: один транскрипт на ad_name.
      await sb.from("gemini_analyses").delete().eq("mode", "transcript").eq("ad_name", ad_name);
      const { error } = await sb.from("gemini_analyses").insert({ mode: "transcript", ad_name, analysis: transcript });
      if (error) { results.push({ ad_name, ok: false, note: error.message }); continue; }

      results.push({ ad_name, ok: true, chars: transcript.length });
    } catch (e) {
      results.push({ ad_name, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, done: results.filter(r => r.ok).length, results });
}
