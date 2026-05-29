import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

// Не-настраиваемое: окно поиска и минимум дневного спенда для «active».
const MIN_DAILY_SPEND = 1;
const LOOKBACK_DAYS = 7;

async function sendTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

export interface EarlyStopResult {
  flagged: number;
  skipped: number;
  ads: { adName: string; flow: string | null; cpl: number; impressions: number; spend: number }[];
  checkedAt: string;
}

interface ActiveAd {
  adId: string;
  adName: string;
  flow: string | null;
  spend: number;
  impressions: number;
  maxDate: string;
  lastDaySpend: number;
}

interface PbiStat {
  adNameKey: string;
  leads: number;
  qualLeads: number;
}

// POST — scan and flag candidates (no auto-pause, manual decision only)
export async function POST() {
  const supabase = createServiceClient();
  const settings = await getSettings();
  const EARLY_STOP_CPL = settings.earlyStopCpl;
  const MIN_IMPRESSIONS = settings.earlyStopMinImpressions;
  const DEAD_ZERO_SPEND_FLOOR = settings.deadZeroSpendFloor;

  const today = new Date();
  const lookbackDate = new Date(today.getTime() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
  const yesterday    = new Date(today.getTime() - 1   * 864e5).toISOString().slice(0, 10);

  // ── Step 1: Get recent Meta data (last 7 days) ──────────────────────────────
  const { data: metaRows, error: metaErr } = await supabase
    .from("meta_ads")
    .select("ad_id, ad_name, flow, spend, impressions, date")
    .gte("date", lookbackDate);

  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });

  // Aggregate per ad_name: sum spend/impressions, track max date and last-day spend
  const byName: Record<string, ActiveAd> = {};
  for (const row of metaRows ?? []) {
    const key = (row.ad_name as string).trim().toLowerCase();
    if (!byName[key]) {
      byName[key] = {
        adId: row.ad_id as string,
        adName: (row.ad_name as string).trim(),
        flow: row.flow as string | null,
        spend: 0,
        impressions: 0,
        maxDate: row.date as string,
        lastDaySpend: 0,
      };
    }
    const entry = byName[key];
    entry.spend       += parseFloat(String(row.spend ?? 0));
    entry.impressions += parseInt(String(row.impressions ?? 0));
    if ((row.date as string) > entry.maxDate) {
      entry.maxDate = row.date as string;
    }
    // Track spend on the most recent day seen (to detect if still running)
    if ((row.date as string) >= yesterday) {
      entry.lastDaySpend += parseFloat(String(row.spend ?? 0));
    }
  }

  // Keep only ads active recently (had spend ≥ €1 on their last reported day)
  const activeAds = Object.values(byName).filter(
    a => a.maxDate >= yesterday && a.lastDaySpend >= MIN_DAILY_SPEND
  );

  if (!activeAds.length) {
    return NextResponse.json({
      ok: true, flagged: 0, skipped: 0, ads: [], checkedAt: new Date().toISOString(),
    } satisfies EarlyStopResult & { ok: true });
  }

  // ── Step 2: Get fresh PBI leads (latest elly sync rows) ────────────────────
  const { data: pbiRows } = await supabase
    .from("pbi_metrics")
    .select("ad_name, leads, qual_leads")
    .like("ad_id", "elly:%");

  const pbiByName: Record<string, PbiStat> = {};
  for (const row of pbiRows ?? []) {
    if (!row.ad_name) continue;
    const key = (row.ad_name as string).trim().toLowerCase();
    if (!pbiByName[key]) pbiByName[key] = { adNameKey: key, leads: 0, qualLeads: 0 };
    pbiByName[key].leads     += parseInt(String(row.leads ?? 0));
    pbiByName[key].qualLeads += parseInt(String(row.qual_leads ?? 0));
  }

  // ── Step 3: Flag candidates ─────────────────────────────────────────────────
  let flagged = 0;
  let skipped = 0;
  const flaggedAds: EarlyStopResult["ads"] = [];

  for (const ad of activeAds) {
    const pbi = pbiByName[ad.adName.toLowerCase()];
    const leads = pbi?.leads ?? 0;

    // ── Trigger 2: dead-zero-leads — spend≥€50 без единого лида ────────────────
    // Срабатывает РАНЬШЕ CPL-проверки и не требует MIN_IMPRESSIONS,
    // потому что главный сигнал тут — деньги без отдачи.
    if (leads === 0 && ad.spend >= DEAD_ZERO_SPEND_FLOOR) {
      const { data: existing } = await supabase
        .from("creative_alerts")
        .select("id")
        .eq("ad_id", ad.adId)
        .eq("alert_type", "dead_zero_leads")
        .eq("dismissed", false)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      await supabase.from("creative_alerts").insert({
        ad_id:      ad.adId,
        ad_name:    ad.adName,
        flow:       ad.flow,
        alert_type: "dead_zero_leads",
        message:    `Спенд €${ad.spend.toFixed(0)} за 7 дней без единого лида (PBI) при ${ad.impressions.toLocaleString()} показах — остановить`,
        value:      ad.spend,
        threshold:  DEAD_ZERO_SPEND_FLOOR,
      });

      await sendTelegram(
        `🛑 <b>Объявление сжигает бюджет без лидов</b>\n\n` +
        `📛 ${ad.adName}\n` +
        `💸 €${ad.spend.toFixed(0)} спенд (7д) при ${ad.impressions.toLocaleString()} показах, лидов <b>0</b>\n` +
        `📅 Последний спенд: ${ad.maxDate}\n` +
        `Порог тревоги: €${DEAD_ZERO_SPEND_FLOOR}\n\n` +
        `Рекомендуется остановить вручную.`
      );

      flagged++;
      continue;
    }

    if (ad.impressions < MIN_IMPRESSIONS) continue;

    // If no leads data yet (and spend below floor), can't compute CPL → skip
    if (leads === 0) continue;

    const cpl = ad.spend / leads;
    if (cpl <= EARLY_STOP_CPL) continue;

    // Don't duplicate open alerts
    const { data: existing } = await supabase
      .from("creative_alerts")
      .select("id")
      .eq("ad_id", ad.adId)
      .eq("alert_type", "early_stop")
      .eq("dismissed", false)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    await supabase.from("creative_alerts").insert({
      ad_id:      ad.adId,
      ad_name:    ad.adName,
      flow:       ad.flow,
      alert_type: "early_stop",
      message:    `CPL €${cpl.toFixed(1)} > €${EARLY_STOP_CPL} при ${ad.impressions.toLocaleString()} показах за 7 дней (спенд €${ad.spend.toFixed(0)}, лидов ${leads}) — рекомендуется остановить`,
      value:      cpl,
      threshold:  EARLY_STOP_CPL,
    });

    await sendTelegram(
      `⚠️ <b>Ранний кандидат на стоп</b>\n\n` +
      `📛 ${ad.adName}\n` +
      `📊 CPL €${cpl.toFixed(1)} (порог €${EARLY_STOP_CPL}, план €20)\n` +
      `👁 ${ad.impressions.toLocaleString()} показов · €${ad.spend.toFixed(0)} спенд (7д) · ${leads} лидов (PBI)\n` +
      `📅 Последний спенд: ${ad.maxDate}\n\n` +
      `Рекомендуется остановить вручную.`
    );

    flaggedAds.push({ adName: ad.adName, flow: ad.flow, cpl, impressions: ad.impressions, spend: ad.spend });
    flagged++;
  }

  return NextResponse.json({
    ok: true, flagged, skipped, ads: flaggedAds, checkedAt: new Date().toISOString(),
  } satisfies EarlyStopResult & { ok: true });
}

// GET — preview active candidates without creating alerts
export async function GET() {
  const supabase = createServiceClient();
  const settings = await getSettings();
  const EARLY_STOP_CPL = settings.earlyStopCpl;
  const MIN_IMPRESSIONS = settings.earlyStopMinImpressions;

  const today = new Date();
  const lookbackDate = new Date(today.getTime() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
  const yesterday    = new Date(today.getTime() - 1   * 864e5).toISOString().slice(0, 10);

  const { data: metaRows } = await supabase
    .from("meta_ads")
    .select("ad_id, ad_name, flow, spend, impressions, date")
    .gte("date", lookbackDate);

  const byName: Record<string, ActiveAd> = {};
  for (const row of metaRows ?? []) {
    const key = (row.ad_name as string).trim().toLowerCase();
    if (!byName[key]) {
      byName[key] = {
        adId: row.ad_id as string, adName: (row.ad_name as string).trim(),
        flow: row.flow as string | null, spend: 0, impressions: 0,
        maxDate: row.date as string, lastDaySpend: 0,
      };
    }
    byName[key].spend       += parseFloat(String(row.spend ?? 0));
    byName[key].impressions += parseInt(String(row.impressions ?? 0));
    if ((row.date as string) > byName[key].maxDate) byName[key].maxDate = row.date as string;
    if ((row.date as string) >= yesterday) byName[key].lastDaySpend += parseFloat(String(row.spend ?? 0));
  }

  const { data: pbiRows } = await supabase
    .from("pbi_metrics").select("ad_name, leads").like("ad_id", "elly:%");
  const pbiByName: Record<string, number> = {};
  for (const row of pbiRows ?? []) {
    if (!row.ad_name) continue;
    const key = (row.ad_name as string).trim().toLowerCase();
    pbiByName[key] = (pbiByName[key] ?? 0) + parseInt(String(row.leads ?? 0));
  }

  const candidates = Object.values(byName)
    .filter(a => a.maxDate >= yesterday && a.lastDaySpend >= MIN_DAILY_SPEND && a.impressions >= MIN_IMPRESSIONS)
    .map(a => {
      const leads = pbiByName[a.adName.toLowerCase()] ?? 0;
      const cpl   = leads > 0 ? a.spend / leads : null;
      return { adName: a.adName, flow: a.flow, cpl, impressions: a.impressions, spend: a.spend, leads };
    })
    .filter(a => a.cpl != null && a.cpl > EARLY_STOP_CPL);

  return NextResponse.json({
    ok: true,
    threshold: { cpl: EARLY_STOP_CPL, impressions: MIN_IMPRESSIONS, minDailySpend: MIN_DAILY_SPEND },
    candidates,
  });
}
