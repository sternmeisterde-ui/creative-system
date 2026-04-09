import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { runAlertCheck } from "@/lib/alert-check";

export async function POST() {
  try {
    const { created, dismissed } = await runAlertCheck();
    return NextResponse.json({ ok: true, created, dismissed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const supabase = createServiceClient();
  const url = new URL(req.url);

  if (url.searchParams.get("list") !== "1") {
    await runAlertCheck();
  }

  const { data, error } = await supabase
    .from("creative_alerts")
    .select("*")
    .eq("dismissed", false)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, alerts: data ?? [] });
}
