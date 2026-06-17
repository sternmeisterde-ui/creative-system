import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { isPlatformConfigured } from "@/lib/platforms";
import { googleAdsSearch, GOOGLE_CUSTOMER_ID } from "@/lib/google-ads";

// ── Google Ads sync ──────────────────────────────────────────────────────────
// Грейн = КАМПАНИЯ (не объявление). Причина: спенд аккаунта почти весь в
// Performance Max, а у PMax нет ad_group_ad и Google НЕ отдаёт метрики по
// отдельным ассетам/креативам. Campaign-level ловит 100% спенда (PMax + Search +
// Demand Gen + Video) без двойного счёта.
//
// Пишем в meta_ads с platform='google': ad_id = `google:<campaignId>`,
// ad_name = имя кампании, спенд/показы/клики. Поток (com/gov) — из имени кампании.
//
// ЛИДЫ/ВЫРУЧКУ Google НЕ пишем здесь — источник правды это Elly/CRM (реальные сделки),
// а не conversions_value Google. CRM-данные кладёт elly-sync (source='google') в
// pbi_metrics с тем же `google:`-неймспейсом, матч по имени кампании. Так Google
// считается так же, как Meta: спенд из meta_ads, лиды/выручка из Elly.
//
// P·H·B·A-бивариат к Google не применяется: имена кампаний не несут кодов, поэтому
// эти строки видны в панели/тоталах, но в код-сплиты не попадают (codes = null).
export const maxDuration = 120;

interface GoogleCampaignRow {
  campaign?: { id?: string; name?: string; advertisingChannelType?: string; status?: string };
  metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number; conversionsValue?: number };
}

function flowFromCampaign(name: string): "com" | "gov" | null {
  const n = name.toLowerCase();
  if (n.includes("gov")) return "gov";
  if (n.includes("comm")) return "com";
  return null;
}

export async function POST(req: NextRequest) {
  if (!isPlatformConfigured("google")) {
    return NextResponse.json(
      { error: "Google Ads не настроен. Нужны GOOGLE_ADS_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / LOGIN_CUSTOMER_ID / CUSTOMER_ID." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string };
  const today = new Date();
  const dateTo = body.dateTo ?? today.toISOString().slice(0, 10);
  const dateFrom = body.dateFrom ?? new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);

  // Агрегированно по кампании за период (без segments.date → суммы по окну).
  const query = `
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;

  let rows: GoogleCampaignRow[];
  try {
    rows = await googleAdsSearch(query) as GoogleCampaignRow[];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const adRows: Record<string, unknown>[] = [];
  const byChannelType: Record<string, number> = {};
  let totalSpend = 0;

  for (const r of rows) {
    const campId = String(r.campaign?.id ?? "");
    if (!campId) continue;
    const m = r.metrics ?? {};
    const campName = r.campaign?.name ?? "";
    const spend = Number(m.costMicros ?? 0) / 1e6;
    const impressions = Number(m.impressions ?? 0);
    const clicks = Number(m.clicks ?? 0);
    const conversions = Number(m.conversions ?? 0);
    const type = r.campaign?.advertisingChannelType ?? "UNKNOWN";

    // Пропускаем кампании без активности за период — не плодим пустые строки.
    if (spend === 0 && impressions === 0 && conversions === 0) continue;

    byChannelType[type] = (byChannelType[type] ?? 0) + 1;
    totalSpend += spend;

    const adId = `google:${campId}`; // неймспейс (как elly:%) — вид creative_performance фильтрует pbi по нему
    adRows.push({
      ad_id: adId,
      ad_name: campName || adId,
      campaign_id: campId,
      campaign_name: campName || null,
      flow: flowFromCampaign(campName),
      account_id: GOOGLE_CUSTOMER_ID,
      platform: "google",
      date: dateTo,
      spend,
      impressions,
      clicks,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
    });
  }

  const supabase = createServiceClient();
  let metaErr: string | null = null;

  if (adRows.length) {
    const { error } = await supabase.from("meta_ads").upsert(adRows, { onConflict: "ad_id,date" });
    metaErr = error?.message ?? null;
  }

  return NextResponse.json({
    ok: !metaErr,
    platform: "google",
    grain: "campaign",
    dateFrom,
    dateTo,
    fetched: rows.length,
    syncedCampaigns: adRows.length,
    totalSpend: Math.round(totalSpend),
    byChannelType,
    metaErr,
    note: "Лиды/выручка Google приходят из Elly (elly-sync source=google), не из Google API.",
  });
}

export async function GET() {
  return POST(new NextRequest("http://localhost/api/google/sync", { method: "POST", body: "{}" }));
}
