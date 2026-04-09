import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const CPL_RED_THRESHOLD   = 25;   // CPL > €25 за 2 дня подряд → красный
const CTR_DROP_THRESHOLD  = 0.70; // CTR падает ниже 70% от 7-дневного среднего → жёлтый
const MIN_SPEND_ACTIVE    = 1;    // минимальный спенд за день чтобы считать активным
const LOOKBACK_DAYS       = 7;

export type SignalType = "cpl_red" | "ctr_drop";
export interface AdSignal {
  adName: string;
  flow: string | null;
  signalType: SignalType;
  message: string;
  daysAgo: number; // сколько дней с момента первого сигнала
  currentCpl: number | null;
  avgCtr7d: number | null;
  currentCtr: number | null;
}

export interface PackHealthResult {
  status: "healthy" | "warning" | "dying";
  signals: AdSignal[];
  activeAdCount: number;
  checkedAt: string;
}

export async function GET(): Promise<NextResponse<PackHealthResult | { error: string }>> {
  const supabase = createServiceClient();

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);

  // 1. Получаем данные из pbi_metrics за последние 7 дней
  const { data: pbiRows, error: pbiErr } = await supabase
    .from("pbi_metrics")
    .select("ad_name, date, spend, leads, qual_leads")
    .gte("date", sinceStr)
    .order("date", { ascending: false });

  if (pbiErr) return NextResponse.json({ error: pbiErr.message }, { status: 500 });

  // 2. Получаем CTR из meta_ads за последние 7 дней
  const { data: metaRows, error: metaErr } = await supabase
    .from("meta_ads")
    .select("ad_name, flow, date, spend, impressions, ctr")
    .gte("date", sinceStr)
    .order("date", { ascending: false });

  if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 });

  // 3. Определяем активные объявления (спенд в последние 3 дня в meta_ads)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10);

  const activeAdNames = new Set<string>();
  const adFlowMap: Record<string, string | null> = {};
  for (const r of (metaRows ?? [])) {
    if (r.date >= threeDaysAgoStr && (r.spend ?? 0) >= MIN_SPEND_ACTIVE) {
      activeAdNames.add(r.ad_name as string);
      adFlowMap[r.ad_name as string] = r.flow as string | null;
    }
  }

  if (activeAdNames.size === 0) {
    return NextResponse.json({
      status: "healthy",
      signals: [],
      activeAdCount: 0,
      checkedAt: new Date().toISOString(),
    });
  }

  // 4. Строим дневные CPL по pbi_metrics для активных объявлений
  type DayRecord = { date: string; spend: number; leads: number };
  const pbiByAd: Record<string, DayRecord[]> = {};
  for (const r of (pbiRows ?? [])) {
    const name = r.ad_name as string;
    if (!activeAdNames.has(name)) continue;
    if (!pbiByAd[name]) pbiByAd[name] = [];
    pbiByAd[name].push({ date: r.date as string, spend: Number(r.spend) || 0, leads: Number(r.leads) || 0 });
  }

  // 5. Строим дневной CTR по meta_ads для активных объявлений
  type CtrRecord = { date: string; ctr: number; spend: number };
  const ctrByAd: Record<string, CtrRecord[]> = {};
  for (const r of (metaRows ?? [])) {
    const name = r.ad_name as string;
    if (!activeAdNames.has(name)) continue;
    if (!ctrByAd[name]) ctrByAd[name] = [];
    ctrByAd[name].push({ date: r.date as string, ctr: Number(r.ctr) || 0, spend: Number(r.spend) || 0 });
  }

  const signals: AdSignal[] = [];

  for (const adName of activeAdNames) {
    const pbiDays = (pbiByAd[adName] ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const ctrDays = (ctrByAd[adName] ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const flow = adFlowMap[adName] ?? null;

    // ── Сигнал RED: CPL > €25 за последние 2 дня подряд ──────────────────────
    const daysWithLeads = pbiDays.filter(d => d.leads > 0 && d.spend > 0);
    if (daysWithLeads.length >= 2) {
      const [d1, d2] = daysWithLeads;
      const cpl1 = d1.spend / d1.leads;
      const cpl2 = d2.spend / d2.leads;
      if (cpl1 > CPL_RED_THRESHOLD && cpl2 > CPL_RED_THRESHOLD) {
        signals.push({
          adName,
          flow,
          signalType: "cpl_red",
          message: `CPL €${cpl1.toFixed(1)} (сегодня) и €${cpl2.toFixed(1)} (вчера) — выше €${CPL_RED_THRESHOLD} два дня подряд`,
          daysAgo: 0,
          currentCpl: cpl1,
          avgCtr7d: null,
          currentCtr: null,
        });
        continue; // красный сигнал — не добавляем жёлтый
      }
    }

    // ── Сигнал YELLOW: CTR упал ниже 70% от 7-дневного среднего ─────────────
    const ctrWithSpend = ctrDays.filter(d => d.spend >= MIN_SPEND_ACTIVE);
    if (ctrWithSpend.length >= 3) {
      const recent = ctrWithSpend[0];
      const avg7d = ctrWithSpend.reduce((s, d) => s + d.ctr, 0) / ctrWithSpend.length;
      if (avg7d > 0 && recent.ctr < avg7d * CTR_DROP_THRESHOLD) {
        signals.push({
          adName,
          flow,
          signalType: "ctr_drop",
          message: `CTR ${recent.ctr.toFixed(2)}% — упал до ${((recent.ctr / avg7d) * 100).toFixed(0)}% от 7-дневного среднего (${avg7d.toFixed(2)}%)`,
          daysAgo: 0,
          currentCpl: daysWithLeads.length > 0 ? daysWithLeads[0].spend / daysWithLeads[0].leads : null,
          avgCtr7d: avg7d,
          currentCtr: recent.ctr,
        });
      }
    }
  }

  const redCount = signals.filter(s => s.signalType === "cpl_red").length;
  const status: PackHealthResult["status"] =
    redCount >= 2 ? "dying" :
    redCount === 1 || signals.some(s => s.signalType === "ctr_drop") ? "warning" :
    "healthy";

  return NextResponse.json({
    status,
    signals,
    activeAdCount: activeAdNames.size,
    checkedAt: new Date().toISOString(),
  });
}
