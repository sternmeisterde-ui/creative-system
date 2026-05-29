/**
 * Чтение app_settings — единственной строки с порогами KPI / fake_winner / alerts.
 * Меняй через Supabase Studio:  update app_settings set cpl_target = 25 where id = 1;
 *
 * В рамках одного request-а значения кешируются (settingsCache),
 * чтобы не дёргать БД на каждый AI-запрос.
 */
import { createServiceClient } from "./supabase";

export interface AppSettings {
  cplTarget: number;
  cpqlTarget: number;
  minImpressionsForStatus: number;
  lowQualCrThreshold: number;
  shortLifespanDays: number;
  lowRoasAgeDays: number;
  lowRoasMinSpend: number;
  earlyStopCpl: number;
  earlyStopMinImpressions: number;
  deadZeroSpendFloor: number;
  fakeWinnerAlertSpendFloor: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  cplTarget: 20,
  cpqlTarget: 28,
  minImpressionsForStatus: 8000,
  lowQualCrThreshold: 60,
  shortLifespanDays: 7,
  lowRoasAgeDays: 30,
  lowRoasMinSpend: 500,
  earlyStopCpl: 40,
  earlyStopMinImpressions: 2000,
  deadZeroSpendFloor: 50,
  fakeWinnerAlertSpendFloor: 50,
};

let settingsCache: { value: AppSettings; ts: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<AppSettings> {
  if (settingsCache && Date.now() - settingsCache.ts < TTL_MS) {
    return settingsCache.value;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    // Если миграция 011 ещё не применена — отдаём дефолты.
    return DEFAULT_SETTINGS;
  }
  const value: AppSettings = {
    cplTarget:                Number(data.cpl_target),
    cpqlTarget:               Number(data.cpql_target),
    minImpressionsForStatus:  Number(data.min_impressions_for_status),
    lowQualCrThreshold:       Number(data.low_qual_cr_threshold),
    shortLifespanDays:        Number(data.short_lifespan_days),
    lowRoasAgeDays:           Number(data.low_roas_age_days),
    lowRoasMinSpend:          Number(data.low_roas_min_spend),
    earlyStopCpl:             Number(data.early_stop_cpl),
    earlyStopMinImpressions:  Number(data.early_stop_min_impressions),
    deadZeroSpendFloor:       Number(data.dead_zero_spend_floor),
    fakeWinnerAlertSpendFloor: Number(data.fake_winner_alert_spend_floor),
  };
  settingsCache = { value, ts: Date.now() };
  return value;
}
