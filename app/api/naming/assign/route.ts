import { NextResponse } from "next/server";
import { assignMissingCodes } from "@/lib/naming";

// POST /api/naming/assign — назначить коды всем параметрам без кода
export async function POST() {
  try {
    const counts = await assignMissingCodes();
    return NextResponse.json({ ok: true, assigned: counts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
