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

  // Higgsfield: лимит 4 активных задачи. Шлём ПОСЛЕДОВАТЕЛЬНО; как упёрлись в лимит
  // ("Maximum number of concurrent requests") — стоп, остаток дошлётся следующим
  // вызовом по мере освобождения слотов. Так не плодим дубли и не теряем брифы.
  let submitted = 0, deferred = 0;
  const errors: string[] = [];
  for (let i = 0; i < pending.length; i++) {
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
      if (/concurrent/i.test(text)) { deferred = pending.length - submitted; break; } // слоты заняты
      errors.push(`brief ${b.id}: HTTP ${r.status} ${text.slice(0, 150)}`);
    } catch (e) {
      errors.push(`brief ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total: briefs.length,
    alreadyDone: succeeded.size,
    submitted,
    deferred,
    errors: errors.slice(0, 10),
    done: deferred === 0 && errors.length === 0,
  });
}
