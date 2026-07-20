import { NextRequest, NextResponse } from "next/server";

// GET /api/meta/thumb?adId=123 → 302 на СВЕЖИЙ thumbnail/image крео из Meta.
// Превью Meta (creative{thumbnail_url,image_url}) — временные CDN-ссылки, за
// несколько дней протухают (403). Поэтому не храним их, а резолвим по клику/загрузке
// заново по ad_id (аналогично /api/meta/video для видео).
export const maxDuration = 30;

const TOKEN = process.env.META_ACCESS_TOKEN;

export async function GET(req: NextRequest) {
  const adId = req.nextUrl.searchParams.get("adId");
  if (!adId) return NextResponse.json({ error: "adId обязателен" }, { status: 400 });
  if (!TOKEN) return NextResponse.json({ error: "META_ACCESS_TOKEN не задан" }, { status: 503 });

  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
    url.searchParams.set("fields", "creative{thumbnail_url,image_url}");
    url.searchParams.set("access_token", TOKEN);
    const res = await fetch(url.toString());
    const j = await res.json() as { creative?: { thumbnail_url?: string; image_url?: string }; error?: { message: string } };
    if (j.error) return NextResponse.json({ error: j.error.message }, { status: 502 });

    const src = j.creative?.image_url || j.creative?.thumbnail_url;
    if (!src) return NextResponse.json({ error: "нет превью (объявление удалено?)" }, { status: 404 });

    // Кешируем редирект ненадолго — свежий CDN-URL живёт часами, повторные загрузки
    // в рамках сессии не дёргают Graph заново.
    return NextResponse.redirect(src, { status: 302, headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
