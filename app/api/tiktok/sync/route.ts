import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { isPlatformConfigured } from "@/lib/platforms";

// ── TikTok Ads sync (КАРКАС) ────────────────────────────────────────────────────
// Зеркалит /api/meta/sync, но для TikTok Business (Marketing) API. Пишет в ту же
// таблицу meta_ads с platform='tiktok'. Активируется, когда заданы
// TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID; иначе 503 (как elly-sync без ключа).
//
// ВНИМАНИЕ: точные endpoint/поля TikTok API сверить с актуальной докой при активации
// (https://business-api.tiktok.com/portal/docs). Базовая структура ниже.
export const maxDuration = 120;

const TT_BASE = process.env.TIKTOK_API_URL ?? "https://business-api.tiktok.com/open_api/v1.3";
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const ADVERTISER_ID = process.env.TIKTOK_ADVERTISER_ID;

interface TikTokRow { dimensions?: { ad_id?: string }; metrics?: Record<string, string> }

// Тянет ad-level метрики из TikTok Reporting API за период.
async function fetchTikTokReport(dateFrom: string, dateTo: string): Promise<TikTokRow[]> {
  const url = new URL(`${TT_BASE}/report/integrated/get/`);
  url.searchParams.set("advertiser_id", ADVERTISER_ID!);
  url.searchParams.set("report_type", "BASIC");
  url.searchParams.set("data_level", "AUCTION_AD");
  url.searchParams.set("dimensions", JSON.stringify(["ad_id"]));
  url.searchParams.set("metrics", JSON.stringify(["spend", "impressions", "clicks", "cpc", "cpm", "ctr", "reach"]));
  url.searchParams.set("start_date", dateFrom);
  url.searchParams.set("end_date", dateTo);
  url.searchParams.set("page_size", "1000");

  const all: TikTokRow[] = [];
  let page = 1;
  for (; page <= 50; page++) {
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), { headers: { "Access-Token": TOKEN! } });
    const json = await res.json() as { code?: number; message?: string; data?: { list?: TikTokRow[]; page_info?: { total_page?: number } } };
    if (json.code && json.code !== 0) throw new Error(`TikTok API: ${json.message}`);
    all.push(...(json.data?.list ?? []));
    if (page >= (json.data?.page_info?.total_page ?? 1)) break;
  }
  return all;
}

export async function POST(req: NextRequest) {
  // Гард каркаса: пока нет токена — интеграция не активна.
  if (!isPlatformConfigured("tiktok")) {
    return NextResponse.json(
      { error: "TikTok не настроен. Задай TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID. Это каркас — интеграция активируется с кредами." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string };
  const today = new Date();
  const dateTo = body.dateTo ?? today.toISOString().slice(0, 10);
  const dateFrom = body.dateFrom ?? new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);

  const supabase = createServiceClient();
  try {
    const rows = await fetchTikTokReport(dateFrom, dateTo);
    // TODO при активации: ad_name тянуть из /ad/get/ (reporting отдаёт только ad_id);
    // flow (com/gov) — из имени или маппинга кампаний TikTok.
    const upsert = rows.map(r => ({
      ad_id:       String(r.dimensions?.ad_id ?? ""),
      ad_name:     String(r.dimensions?.ad_id ?? ""), // заменить на реальное имя из /ad/get/
      platform:    "tiktok",
      date:        dateTo,
      spend:       parseFloat(r.metrics?.spend ?? "0"),
      impressions: parseInt(r.metrics?.impressions ?? "0"),
      clicks:      parseInt(r.metrics?.clicks ?? "0"),
      reach:       parseInt(r.metrics?.reach ?? "0"),
      cpm:         parseFloat(r.metrics?.cpm ?? "0"),
      ctr:         parseFloat(r.metrics?.ctr ?? "0"),
      cpc:         parseFloat(r.metrics?.cpc ?? "0"),
    })).filter(r => r.ad_id);

    if (upsert.length > 0) {
      const { error } = await supabase.from("meta_ads").upsert(upsert, { onConflict: "ad_id,date" });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, platform: "tiktok", synced: upsert.length, dateFrom, dateTo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET() {
  return POST(new NextRequest("http://localhost/api/tiktok/sync", { method: "POST", body: "{}" }));
}
