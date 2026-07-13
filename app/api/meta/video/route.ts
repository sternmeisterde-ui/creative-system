import { NextRequest, NextResponse } from "next/server";
import { resolveMetaVideoSource } from "@/lib/gemini";

// GET /api/meta/video?videoId=123 → 302 на свежий CDN-mp4 из Meta.
// Source-ссылки Meta временные (протухают за часы), поэтому резолвим по клику,
// а не храним. <video src> следует за редиректом и играет напрямую с CDN.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "videoId обязателен" }, { status: 400 });

  const source = await resolveMetaVideoSource(videoId);
  if (!source) {
    return NextResponse.json(
      { error: "source видео недоступен (объявление удалено из Meta или нет прав на видео)" },
      { status: 404 }
    );
  }
  return NextResponse.redirect(source, 302);
}
