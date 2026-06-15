/**
 * POST /api/pack/produce
 *
 * Запускает генерацию для всех approved-брифов пакетной сессии.
 * Для каждого брифа вызывает /api/creative-gen/generate (статика, Gemini, синхронно)
 * или /api/creative-gen/generate-scenes (видео, Higgsfield). Вызовы идут
 * ПАРАЛЛЕЛЬНО через пул с ограничением одновременности:
 *   • статика (Gemini) — лимита нет, пул 6 → весь пак из 10 успевает за один прогон;
 *   • видео (Higgsfield) — жёсткий лимит 4 активных задачи, пул 4; что не влезло,
 *     помечается deferred и дошлётся повторным прогоном (идемпотентно).
 *
 * Раньше цикл был ПОСЛЕДОВАТЕЛЬНЫМ при maxDuration=60: синхронная Gemini-статика
 * (~30с/крео) не успевала — функцию убивало на ~4-м креативе (баг «4/10»).
 *
 * Body: { sessionId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

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

  // approved-брифы сессии
  const { data: briefs, error } = await supabase
    .from("briefs")
    .select("id, persona_id, format")
    .eq("session_id", sessionId)
    .eq("status", "approved");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!briefs || briefs.length === 0) {
    return NextResponse.json({ error: "Нет approved-брифов в сессии" }, { status: 400 });
  }

  // Идемпотентность: пропускаем брифы с уже успешной/активной генерацией,
  // ретраим только без генерации или со статусом error/failed.
  const briefIds = briefs.map(b => b.id);
  const { data: gens } = await supabase
    .from("creative_generations").select("brief_id, status").in("brief_id", briefIds);
  const okStatuses = (g: { status: string }) => !["error", "failed"].includes(String(g.status));
  const succeeded = new Set((gens ?? []).filter(okStatuses).map(g => g.brief_id));
  const pending = briefs.filter(b => !succeeded.has(b.id));

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, total: briefs.length, alreadyDone: succeeded.size, submitted: 0, deferred: 0, done: true });
  }

  const personaIds = Array.from(new Set(pending.map(b => b.persona_id).filter(Boolean)));
  const { data: personas } = await supabase.from("personas").select("id, name").in("id", personaIds);
  const personaName = new Map((personas ?? []).map(p => [p.id, p.name as string]));

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "creative.sternmeister.de";
  const baseUrl = `${proto}://${host}`;

  // static → одна картинка; video* → многосценное видео (Kling + stitch)
  const STATIC_FORMATS = new Set(["static"]);
  const endpointFor = (fmt: string) =>
    STATIC_FORMATS.has(fmt) ? "/api/creative-gen/generate" : "/api/creative-gen/generate-scenes";

  // Параллельный пул. Статика (Gemini) не имеет лимита одновременности → пул 6,
  // весь пак из 10 успевает за один прогон. Видео (Higgsfield) — жёсткий лимит 4
  // активных задачи → пул 4; что не влезло (ответ "concurrent"), помечаем deferred
  // и дошлём повторным прогоном (идемпотентно, без дублей).
  const allStatic = pending.every(b => STATIC_FORMATS.has(String(b.format ?? "ugc")));
  const concurrency = Math.min(allStatic ? 6 : 4, pending.length);

  let submitted = 0, deferred = 0, failed = 0;
  const errors: string[] = [];
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= pending.length) return;
      const b = pending[i];
      const endpoint = endpointFor(String(b.format ?? "ugc"));
      try {
        const r = await fetch(`${baseUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefId: b.id, personaName: personaName.get(b.persona_id) ?? "" }),
        });
        if (r.ok) { submitted++; continue; }
        const text = await r.text();
        if (/concurrent/i.test(text)) { deferred++; continue; } // слот Higgsfield занят — дошлём повторным прогоном
        failed++;
        errors.push(`brief ${b.id}: HTTP ${r.status} ${text.slice(0, 150)}`);
      } catch (e) {
        failed++;
        errors.push(`brief ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  return NextResponse.json({
    ok: true,
    total: briefs.length,
    alreadyDone: succeeded.size,
    submitted,
    deferred,
    failed,
    errors: errors.slice(0, 10),
    done: deferred === 0 && failed === 0,
  });
}
