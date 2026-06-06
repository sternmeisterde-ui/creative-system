/**
 * POST /api/pack/produce
 *
 * Запускает Higgsfield-генерацию для всех брифов пакетной сессии разом.
 * Внутри для каждого approved-брифа делает fire-and-forget вызов
 * /api/creative-gen/generate. Возвращает сразу — генерация идёт async
 * (Higgsfield принимает job, выполняет в своей очереди).
 *
 * Body: { sessionId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json() as { sessionId: string };
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  if (!process.env.HIGGSFIELD_API_KEY_ID) {
    return NextResponse.json({
      error: "Higgsfield integration not configured (HIGGSFIELD_API_KEY_ID missing).",
    }, { status: 503 });
  }

  const supabase = createServiceClient();

  // Берём все approved-брифы сессии (нужен format чтобы выбрать routing)
  const { data: briefs, error } = await supabase
    .from("briefs")
    .select("id, persona_id, format")
    .eq("session_id", sessionId)
    .eq("status", "approved");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!briefs || briefs.length === 0) {
    return NextResponse.json({ error: "Нет approved-брифов в сессии" }, { status: 400 });
  }

  const personaIds = Array.from(new Set(briefs.map(b => b.persona_id).filter(Boolean)));
  const { data: personas } = await supabase
    .from("personas")
    .select("id, name")
    .in("id", personaIds);
  const personaName = new Map((personas ?? []).map(p => [p.id, p.name as string]));

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "creative.sternmeister.de";
  const baseUrl = `${proto}://${host}`;

  // Routing по формату:
  //   static  → /api/creative-gen/generate         (одна картинка через nano-banana)
  //   video*  → /api/creative-gen/generate-scenes  (многосценное видео 30-60 сек через Kling + Creatomate stitch)
  const STATIC_FORMATS = new Set(["static"]);
  const endpointFor = (fmt: string) =>
    STATIC_FORMATS.has(fmt) ? "/api/creative-gen/generate" : "/api/creative-gen/generate-scenes";

  const results = await Promise.allSettled(
    briefs.map(b => {
      const endpoint = endpointFor(String(b.format ?? "ugc"));
      return fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          briefId: b.id,
          personaName: personaName.get(b.persona_id) ?? "",
        }),
      }).then(async r => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`brief ${b.id} via ${endpoint}: HTTP ${r.status} ${text.slice(0, 200)}`);
        }
        return r.json();
      });
    })
  );

  const okCount   = results.filter(r => r.status === "fulfilled").length;
  const failCount = results.filter(r => r.status === "rejected").length;
  const errors    = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map(r => String(r.reason).slice(0, 200))
    .slice(0, 10);

  return NextResponse.json({
    ok: true,
    total: briefs.length,
    succeeded: okCount,
    failed: failCount,
    errors,
  });
}
