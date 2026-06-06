/**
 * GET /api/pack/history
 *
 * Возвращает последние сгенерированные паки (последние 20).
 * Используется в /builder для показа истории.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("constructor_sessions")
    .select("id, name, flow, format, generated_at, pack_size, pack_metadata, status")
    .not("pack_metadata", "is", null)
    .order("generated_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sessions: data ?? [] });
}
