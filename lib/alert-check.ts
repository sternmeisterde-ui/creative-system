import { createServiceClient } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  });
}

export async function runAlertCheck(): Promise<{ created: number; dismissed: number }> {
  const supabase = createServiceClient();
  const settings = await getSettings();

  // Get last 2 distinct dates from meta_ads
  const { data: datesRows } = await supabase
    .from("meta_ads")
    .select("date")
    .order("date", { ascending: false })
    .limit(300);

  const allDates = [...new Set((datesRows ?? []).map(r => r.date as string))].sort().reverse();
  const last2 = allDates.slice(0, 2);
  if (last2.length < 2) return { created: 0, dismissed: 0 };

  // Active ads = spent > €1 on BOTH of the last 2 days
  const [{ data: day0Rows }, { data: day1Rows }] = await Promise.all([
    supabase.from("meta_ads").select("ad_id").eq("date", last2[0]).gt("spend", 1),
    supabase.from("meta_ads").select("ad_id").eq("date", last2[1]).gt("spend", 1),
  ]);

  const day0Ids = new Set((day0Rows ?? []).map(r => r.ad_id as string));
  const day1Ids = new Set((day1Rows ?? []).map(r => r.ad_id as string));
  const activeIds = [...day0Ids].filter(id => day1Ids.has(id));
  if (activeIds.length === 0) return { created: 0, dismissed: 0 };

  const { data: perfRows } = await supabase
    .from("creative_performance")
    .select("ad_id, ad_name, flow, cpl, cpql, leads, impressions, spend, roas, cr_lead_to_qual, lifespan_days, age_days, auto_status, risk_signals")
    .in("ad_id", activeIds);

  const loserIds = new Set((perfRows ?? []).filter(r => r.auto_status === "loser").map(r => r.ad_id as string));
  // Fake winners qualifying for alert: порог из app_settings (по умолчанию €50).
  const FAKE_WINNER_SPEND_FLOOR = settings.fakeWinnerAlertSpendFloor;
  const fakeWinnerRows = (perfRows ?? []).filter(
    r => r.auto_status === "fake_winner" && (r.spend as number ?? 0) >= FAKE_WINNER_SPEND_FLOOR
  );
  const fakeWinnerIds = new Set(fakeWinnerRows.map(r => r.ad_id as string));

  // Auto-dismiss alerts for ads that are no longer losers
  const { data: openAlerts } = await supabase
    .from("creative_alerts")
    .select("id, ad_id")
    .eq("alert_type", "cpl_spike")
    .eq("dismissed", false);

  const staleIds = (openAlerts ?? [])
    .filter(a => !loserIds.has(a.ad_id as string))
    .map(a => a.id as string);

  if (staleIds.length > 0) {
    await supabase.from("creative_alerts").update({ dismissed: true }).in("id", staleIds);
  }

  // Auto-dismiss fake_winner alerts для объявлений, которые больше не fake_winner
  // (либо стали виннером, либо перешли в loser/testing — в любом случае контекст другой)
  const { data: openFakeAlerts } = await supabase
    .from("creative_alerts")
    .select("id, ad_id")
    .eq("alert_type", "fake_winner_detected")
    .eq("dismissed", false);
  const staleFakeIds = (openFakeAlerts ?? [])
    .filter(a => !fakeWinnerIds.has(a.ad_id as string))
    .map(a => a.id as string);
  if (staleFakeIds.length > 0) {
    await supabase.from("creative_alerts").update({ dismissed: true }).in("id", staleFakeIds);
  }

  // Create new alerts for losers
  const losers = (perfRows ?? []).filter(r => r.auto_status === "loser");
  let created = 0;

  for (const row of losers) {
    const cpl  = row.cpl  as number | null;
    const cpql = row.cpql as number | null;

    const { data: existing } = await supabase
      .from("creative_alerts")
      .select("id")
      .eq("ad_id", row.ad_id)
      .eq("alert_type", "cpl_spike")
      .eq("dismissed", false)
      .maybeSingle();
    if (existing) continue;

    const metricStr = cpl && cpql
      ? `CPL €${cpl.toFixed(1)}, CPQL €${cpql.toFixed(1)}`
      : cpl
      ? `CPL €${cpl.toFixed(1)}`
      : `CPQL €${cpql?.toFixed(1)}`;

    await supabase.from("creative_alerts").insert({
      ad_id:      row.ad_id,
      ad_name:    row.ad_name,
      flow:       row.flow,
      alert_type: "cpl_spike",
      message:    `${metricStr} — превышает цель (CPL €20 / CPQL €28) при ${(row.impressions as number).toLocaleString()} показах`,
      value:      cpl ?? cpql ?? 0,
      threshold:  20,
    });

    await sendTelegram(
      `⚠️ <b>Лузер — активен 2 дня</b>\n\n` +
      `📛 ${row.ad_name as string}\n` +
      `📊 ${metricStr}\n` +
      `👁 ${(row.impressions as number).toLocaleString()} показов\n` +
      `🎯 Цель: CPL ≤ €20 / CPQL ≤ €28\n\n` +
      `Рекомендуется остановить.`
    );
    created++;
  }

  // ── Fake winner detected: прошли KPI, но имеют red flags + spend ≥ €50 ────
  const RISK_LABEL: Record<string, string> = {
    low_qual_cr:   "слабая Lead→Qual воронка (<60%)",
    short_lifespan: "короткий жизненный цикл (<7 дней)",
    low_roas_30d:  "ROAS<1 при возрасте ≥30 дней и spend≥€500",
  };
  for (const row of fakeWinnerRows) {
    const { data: existing } = await supabase
      .from("creative_alerts")
      .select("id")
      .eq("ad_id", row.ad_id)
      .eq("alert_type", "fake_winner_detected")
      .eq("dismissed", false)
      .maybeSingle();
    if (existing) continue;

    const signals = (row.risk_signals as string[] | null) ?? [];
    const signalsHuman = signals.map(s => RISK_LABEL[s] ?? s).join("; ");
    const cpl  = row.cpl  as number | null;
    const cpql = row.cpql as number | null;
    const roas = row.roas as number | null;
    const cr   = row.cr_lead_to_qual as number | null;
    const spend = row.spend as number;

    await supabase.from("creative_alerts").insert({
      ad_id:      row.ad_id,
      ad_name:    row.ad_name,
      flow:       row.flow,
      alert_type: "fake_winner_detected",
      message:    `Прошёл KPI (CPL €${cpl?.toFixed(1) ?? "—"}, CPQL €${cpql?.toFixed(1) ?? "—"}), но: ${signalsHuman}. Spend €${spend.toFixed(0)}.`,
      value:      spend,
      threshold:  FAKE_WINNER_SPEND_FLOOR,
    });

    await sendTelegram(
      `🟠 <b>Fake winner — KPI прошёл, но деньги в минус</b>\n\n` +
      `📛 ${row.ad_name as string}\n` +
      `📊 CPL €${cpl?.toFixed(1) ?? "—"} · CPQL €${cpql?.toFixed(1) ?? "—"} · CR ${cr?.toFixed(0) ?? "—"}% · ROAS ${roas?.toFixed(2) ?? "—"}\n` +
      `💸 Spend: €${spend.toFixed(0)}\n` +
      `⚑ Red flags: ${signalsHuman}\n\n` +
      `Внешне выглядит как успех, по KPI зелёный — но воронка/экономика сломаны. Рассмотри стоп.`
    );
    created++;
  }

  // Pack dying check: 2+ active losers → fire Telegram CTA once
  const PACK_DYING_THRESHOLD = 2;
  if (losers.length >= PACK_DYING_THRESHOLD) {
    const { data: existingPackAlert } = await supabase
      .from("creative_alerts")
      .select("id")
      .eq("alert_type", "pack_dying")
      .eq("dismissed", false)
      .maybeSingle();

    if (!existingPackAlert) {
      const dyingFlow = losers[0]?.flow as string | null ?? "com";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL ?? "localhost:3000"}`;
      const builderUrl = `${appUrl}/builder?autoRecommend=1&flow=${dyingFlow}&reason=pack_dying`;

      await supabase.from("creative_alerts").insert({
        ad_id:      `pack_dying_${new Date().toISOString().slice(0, 10)}`,
        ad_name:    "Пак",
        flow:       dyingFlow,
        alert_type: "pack_dying",
        message:    `${losers.length} активных лузера — пак умирает. Пора запустить новый производственный цикл.`,
        value:      losers.length,
        threshold:  PACK_DYING_THRESHOLD,
      });

      await sendTelegram(
        `🔴 <b>Пак умирает — ${losers.length} активных лузера</b>\n\n` +
        losers.map(r => `📛 ${r.ad_name as string}`).join("\n") +
        `\n\n🚀 Запустить новый производственный цикл:\n${builderUrl}`
      );
    }
  } else {
    // Dismiss pack_dying alert if pack recovered
    await supabase
      .from("creative_alerts")
      .update({ dismissed: true })
      .eq("alert_type", "pack_dying")
      .eq("dismissed", false);
  }

  return { created, dismissed: staleIds.length + staleFakeIds.length };
}
