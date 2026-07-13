import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { analyzeCreativeParams, resolveMetaVideoSource, type CreativeParams } from "@/lib/gemini";

// POST { adName } → разбирает крео Gemini на параметры (хук/энгл/персона/боди/...)
// и кеширует в gemini_analyses(mode='creative_params', ad_name). Контент стабилен,
// поэтому ключ = ad_name: разобрали раз — переиспользуем во всех неделях.
export const maxDuration = 300;

const k = (s: string) => (s ?? "").trim().toLowerCase();

export async function POST(req: NextRequest) {
  const { adName } = await req.json().catch(() => ({})) as { adName?: string };
  if (!adName) return NextResponse.json({ error: "adName обязателен" }, { status: 400 });

  const sb = createServiceClient();

  // ассет по имени (с video_id или картинкой)
  const { data: creatives } = await sb
    .from("meta_creatives")
    .select("ad_name, asset_url, video_id, thumbnail_url")
    .eq("ad_name", adName)
    .limit(5);
  const cre = (creatives ?? []).find(c => c.asset_url || c.video_id);
  if (!cre) return NextResponse.json({ error: "нет ассета в meta_creatives" }, { status: 404 });

  let assetUrl = cre.asset_url as string | null;
  if (cre.video_id) assetUrl = (await resolveMetaVideoSource(String(cre.video_id))) ?? cre.thumbnail_url ?? cre.asset_url;
  if (!assetUrl) return NextResponse.json({ error: "не удалось получить ассет (видео удалено?)" }, { status: 404 });

  let params: CreativeParams;
  try {
    params = await analyzeCreativeParams(assetUrl);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // один разбор на имя — перезаписываем
  await sb.from("gemini_analyses").delete().eq("mode", "creative_params").eq("ad_name", adName);
  const { error } = await sb.from("gemini_analyses").insert({ mode: "creative_params", ad_name: adName, analysis: JSON.stringify(params) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ adName, params });
}

// GET ?adNames=a,b,c → карта уже готовых разборов (для страницы недели).
export async function GET(req: NextRequest) {
  const sb = createServiceClient();
  const raw = req.nextUrl.searchParams.get("adNames");
  const wanted = raw ? new Set(raw.split("|").map(k)) : null;

  let rows: { ad_name: string; analysis: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("gemini_analyses").select("ad_name, analysis")
      .eq("mode", "creative_params").not("ad_name", "is", null)
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = rows.concat((data ?? []) as { ad_name: string; analysis: string }[]);
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const map: Record<string, CreativeParams> = {};
  for (const r of rows) {
    const key = k(r.ad_name);
    if (wanted && !wanted.has(key)) continue;
    if (map[key]) continue;
    try { map[key] = JSON.parse(r.analysis) as CreativeParams; } catch { /* skip битый JSON */ }
  }
  return NextResponse.json({ params: map });
}
