import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const TOKEN = process.env.META_ACCESS_TOKEN!;

// POST /api/meta/pause — pause a Meta ad by ad_id
export async function POST(req: NextRequest) {
  const { adId, alertId } = await req.json() as { adId: string; alertId?: string };

  if (!adId) return NextResponse.json({ error: "adId required" }, { status: 400 });

  // Call Meta API to pause
  const url = `https://graph.facebook.com/v21.0/${adId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "PAUSED", access_token: TOKEN }),
  });

  const json = await res.json() as { success?: boolean; error?: { message: string } };

  if (json.error) {
    return NextResponse.json({ error: json.error.message }, { status: 400 });
  }

  // Dismiss alert if provided
  if (alertId) {
    const supabase = createServiceClient();
    await supabase.from("creative_alerts").update({ dismissed: true }).eq("id", alertId);
  }

  return NextResponse.json({ ok: true, adId, paused: true });
}
