import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getMetaAccountsMap } from "@/lib/brief";

const TOKEN = process.env.META_ACCESS_TOKEN!;
// flows + ad accounts из brief.config.ts (per-flow env-имя), напр. { com: 'act_xxx', gov: 'act_yyy' }
const ACCOUNTS = getMetaAccountsMap();

const FIELDS = [
  "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name",
  "spend", "impressions", "clicks", "reach", "frequency",
  "cpm", "ctr", "cpc",
  // Видео-метрики. Hook rate = 3-сек просмотры (action 'video_view' в actions) / показы —
  // ЭТО измеряет хук (а не автоплей, как плеи). hold = ThruPlay / 3-сек просмотры.
  "video_play_actions", "video_thruplay_watched_actions", "actions",
].join(",");

// Meta отдаёт action-метрики массивом [{action_type, value}] — суммируем value.
function actionVal(arr: unknown): number {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((s: number, a) => s + (parseInt(String((a as { value?: string }).value ?? 0)) || 0), 0);
}

// Значение конкретного action_type из массива actions (напр. 'video_view' = 3-сек просмотры).
function actionTypeVal(arr: unknown, type: string): number {
  if (!Array.isArray(arr)) return 0;
  const hit = arr.find(a => (a as { action_type?: string }).action_type === type);
  return hit ? parseInt(String((hit as { value?: string }).value ?? 0)) || 0 : 0;
}

async function fetchAdInsights(accountId: string, dateFrom: string, dateTo: string) {
  const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/insights`);
  url.searchParams.set("access_token", TOKEN);
  url.searchParams.set("level", "ad");
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("time_range", JSON.stringify({ since: dateFrom, until: dateTo }));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("limit", "500");

  const all: Record<string, unknown>[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const json = await res.json() as { data: Record<string, unknown>[]; paging?: { next?: string }; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    all.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }

  return all;
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();

  // Диапазон дат: последние 30 дней по умолчанию, или из body
  const body = await req.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string };
  const today = new Date();
  const dateTo = body.dateTo ?? today.toISOString().slice(0, 10);
  const dateFrom = body.dateFrom ?? new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);

  const results: { flow: string; count: number; error?: string }[] = [];

  for (const [flow, accountId] of Object.entries(ACCOUNTS)) {
    try {
      const rows = await fetchAdInsights(accountId, dateFrom, dateTo);

      const upsertRows = rows.map(r => ({
        ad_id:         String(r.ad_id ?? ""),
        ad_name:       String(r.ad_name ?? ""),
        adset_id:      String(r.adset_id ?? ""),
        adset_name:    String(r.adset_name ?? ""),
        campaign_id:   String(r.campaign_id ?? ""),
        campaign_name: String(r.campaign_name ?? ""),
        flow,
        account_id:    accountId,
        date:          String(r.date_start ?? dateTo),
        spend:         parseFloat(String(r.spend ?? 0)),
        impressions:   parseInt(String(r.impressions ?? 0)),
        clicks:        parseInt(String(r.clicks ?? 0)),
        reach:         parseInt(String(r.reach ?? 0)),
        frequency:     parseFloat(String(r.frequency ?? 0)),
        cpm:           parseFloat(String(r.cpm ?? 0)),
        ctr:           parseFloat(String(r.ctr ?? 0)),
        cpc:           parseFloat(String(r.cpc ?? 0)),
        video_plays:    actionVal(r.video_play_actions),
        // Нумератор hook rate: 3-сек просмотры (action 'video_view') — меряет ХУК,
        // а не автоплей. Колонка video_3s исторически так названа. Хук = video_3s/показы.
        video_3s:       actionTypeVal(r.actions, "video_view"),
        video_thruplay: actionVal(r.video_thruplay_watched_actions),
      }));

      if (upsertRows.length > 0) {
        const { error } = await supabase
          .from("meta_ads")
          .upsert(upsertRows, { onConflict: "ad_id,date" });
        if (error) throw new Error(error.message);
      }

      // Лог
      await supabase.from("meta_sync_log").insert({
        account_id: accountId,
        date_from: dateFrom,
        date_to: dateTo,
        ads_count: upsertRows.length,
        status: "ok",
      });

      results.push({ flow, count: upsertRows.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("meta_sync_log").insert({
        account_id: accountId,
        date_from: dateFrom,
        date_to: dateTo,
        ads_count: 0,
        status: "error",
        error: msg,
      });
      results.push({ flow, count: 0, error: msg });
    }
  }

  // After Meta sync — fire Elly sync in background (Elly → alert check chain)
  const anySuccess = results.some(r => !r.error);
  if (anySuccess) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    fetch(`${base}/api/pbi/elly-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateFrom, dateTo }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, dateFrom, dateTo, results });
}

// GET — для проверки и ручного запуска
export async function GET() {
  return POST(new NextRequest("http://localhost/api/meta/sync", { method: "POST", body: "{}" }));
}
