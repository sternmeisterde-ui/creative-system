import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";
import { syncElly } from "@/app/api/pbi/elly-sync/route";

// Сборка недели дёргает Plurio (SSE + poll) за окно — как lifetime elly-sync.
export const maxDuration = 300;

// ── Замороженный per-креатив снапшот недели ─────────────────────────────
export interface WeeklyCreativeRow {
  adId:        string;
  adName:      string;
  flow:        string | null;
  format:      string | null;
  // превью из meta_creatives
  thumbnailUrl: string | null;
  assetUrl:     string | null;   // картинка/превью для показа
  videoId:      string | null;
  objectType:   string | null;
  // метрики за окно недели
  spend:        number;
  impressions:  number;
  cpm:          number | null;
  clicks:       number;
  cpc:          number | null;
  ctr:          number | null;
  crClickLead:  number | null;   // leads / clicks * 100
  leads:        number;
  cpl:          number | null;
  qualLeads:    number;
  cpql:         number | null;
  hookRate:     number | null;
  holdRate:     number | null;
  status:       "winner" | "loser" | "testing";
}

export interface WeeklyReport {
  id:          string;
  createdAt:   string;
  weekStart:   string;
  weekEnd:     string;
  label:       string;
  rows:        WeeklyCreativeRow[];
  summary:     string;   // AI-разбор недели (markdown)
  summaryNote: string;   // командный шторм уровня недели
  document:    string;   // итоговый док «Что делаем» (направления → ТЗ)
}

export interface WeeklyReportSummary {
  id:        string;
  createdAt: string;
  weekStart: string;
  weekEnd:   string;
  label:     string;
  adCount:   number;
}

const key = (s: string) => s.trim().toLowerCase();
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

// GET /api/analytics/weekly            → список снапшотов
// GET /api/analytics/weekly?id=UUID    → один снапшот + заметки
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const { data: report, error } = await supabase
      .from("weekly_creative_reports").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: notes } = await supabase
      .from("weekly_creative_notes").select("ad_id, note, ai_note, todo").eq("report_id", id);

    return NextResponse.json({
      report: {
        id: report.id, createdAt: report.created_at,
        weekStart: report.week_start, weekEnd: report.week_end,
        label: report.label, rows: report.rows,
        summary: report.summary ?? "", summaryNote: report.summary_note ?? "",
        document: report.document ?? "",
      } as WeeklyReport,
      notes: notes ?? [],
    });
  }

  const { data, error } = await supabase
    .from("weekly_creative_reports")
    .select("id, created_at, week_start, week_end, label, rows")
    .order("week_start", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list: WeeklyReportSummary[] = (data ?? []).map(r => ({
    id: r.id, createdAt: r.created_at,
    weekStart: r.week_start, weekEnd: r.week_end, label: r.label,
    adCount: Array.isArray(r.rows) ? r.rows.length : 0,
  }));
  return NextResponse.json({ reports: list });
}

// POST /api/analytics/weekly  { weekStart, weekEnd, label? }
// Собирает срез из meta_ads + pbi_metrics за окно [weekStart, weekEnd],
// join meta_creatives за превью, замораживает снапшотом (upsert по окну).
export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json().catch(() => ({})) as { weekStart?: string; weekEnd?: string; label?: string };
  const { weekStart, weekEnd } = body;
  if (!weekStart || !weekEnd) {
    return NextResponse.json({ error: "weekStart и weekEnd обязательны (YYYY-MM-DD)" }, { status: 400 });
  }

  const [settingsRes, metaRes, mappingRes] = await Promise.all([
    supabase.from("app_settings").select("cpl_target, cpql_target, min_impressions_for_status").eq("id", 1).maybeSingle(),
    supabase.from("meta_ads")
      .select("ad_id, ad_name, flow, spend, impressions, clicks, video_3s, video_thruplay")
      .gte("date", weekStart).lte("date", weekEnd),
    supabase.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
  ]);

  if (metaRes.error) return NextResponse.json({ error: metaRes.error.message }, { status: 500 });

  // ── Лиды/квал за ИМЕННО ЭТО ОКНО — из Plurio (дневной истории в БД нет) ──
  // Meta = per-AdId, Google (PMax) = per-CampaignName; джойн к meta_ads по имени.
  // Meta обязателен (падаем при ошибке); Google опционален (может не быть лидов).
  let ellyRows: Awaited<ReturnType<typeof syncElly>>;
  try {
    const [meta, google] = await Promise.all([
      syncElly(weekStart, weekEnd, "meta"),
      syncElly(weekStart, weekEnd, "google").catch(() => []),
    ]);
    ellyRows = [...meta, ...google];
  } catch (e) {
    return NextResponse.json({ error: `Elly: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const cplTarget  = Number(settingsRes.data?.cpl_target ?? 20);
  const cpqlTarget = Number(settingsRes.data?.cpql_target ?? 28);
  const minImpr    = Number(settingsRes.data?.min_impressions_for_status ?? 8000);

  const mapping: AdNameMapping[] = (mappingRes.data ?? []).map(r => ({
    adName: r.ad_name, personaCode: r.persona_code, hookCode: r.hook_code,
    bodyCode: r.body_code, angleCode: r.angle_code, format: r.format, flow: r.flow,
  }));

  // ── агрегируем meta по имени объявления (грань view = ad_name) ──
  type MetaAgg = {
    adId: string; adName: string; flow: string | null; topSpend: number;
    spend: number; impressions: number; clicks: number; video3s: number; videoThruplay: number;
  };
  const meta: Record<string, MetaAgg> = {};
  const windowAdIds = new Set<string>();  // все ad_id окна — для фильтра ассетов
  for (const r of (metaRes.data ?? [])) {
    const k = key(r.ad_name as string);
    const spend = Number(r.spend ?? 0);
    if (r.ad_id) windowAdIds.add(r.ad_id as string);
    const cur = meta[k] ??= {
      adId: r.ad_id as string, adName: r.ad_name as string, flow: (r.flow as string | null) ?? null,
      topSpend: -1, spend: 0, impressions: 0, clicks: 0, video3s: 0, videoThruplay: 0,
    };
    cur.spend += spend;
    cur.impressions += Number(r.impressions ?? 0);
    cur.clicks += Number(r.clicks ?? 0);
    cur.video3s += Number(r.video_3s ?? 0);
    cur.videoThruplay += Number(r.video_thruplay ?? 0);
    // канонический ad_id/ad_name/flow — от строки с максимальным спендом
    if (spend > cur.topSpend) {
      cur.topSpend = spend; cur.adId = r.ad_id as string;
      cur.adName = r.ad_name as string; cur.flow = (r.flow as string | null) ?? null;
    }
  }

  // ── лиды по имени (Elly за окно) ──
  const pbi: Record<string, { leads: number; qualLeads: number }> = {};
  for (const r of ellyRows) {
    if (!r.adName) continue;
    const k = key(r.adName);
    const cur = pbi[k] ??= { leads: 0, qualLeads: 0 };
    cur.leads += Number(r.leads ?? 0);
    cur.qualLeads += Number(r.qualLeads ?? 0);
  }

  // ── ассеты: тянем ТОЛЬКО по нужным ad_id/именам (иначе дефолтный лимит
  // Supabase 1000 строк резал таблицу meta_creatives и превью терялись) ──
  const names = Object.values(meta).map(m => m.adName);
  const [byIdRes, byNameRes] = await Promise.all([
    supabase.from("meta_creatives")
      .select("ad_id, ad_name, thumbnail_url, image_url, asset_url, video_id, object_type")
      .in("ad_id", [...windowAdIds]),
    supabase.from("meta_creatives")
      .select("ad_id, ad_name, thumbnail_url, image_url, asset_url, video_id, object_type")
      .in("ad_name", names),
  ]);

  type Creative = NonNullable<typeof byIdRes.data>[number];
  const assetByAdId: Record<string, Creative> = {};
  const assetByName: Record<string, Creative> = {};
  for (const c of [...(byIdRes.data ?? []), ...(byNameRes.data ?? [])]) {
    if (c.ad_id) assetByAdId[c.ad_id] = c;
    if (c.ad_name) assetByName[key(c.ad_name)] ??= c;
  }

  const rows: WeeklyCreativeRow[] = Object.entries(meta).map(([k, m]) => {
    const p = pbi[k] ?? { leads: 0, qualLeads: 0 };
    const asset = assetByAdId[m.adId] ?? assetByName[k] ?? null;
    const parts = parseAdNameWithMapping(m.adName, mapping);

    const cpl  = div(m.spend, p.leads);
    const cpql = div(m.spend, p.qualLeads);
    const hookRate = m.video3s > 0 ? (m.video3s / m.impressions) * 100 : null;
    const holdRate = m.video3s > 0 ? (m.videoThruplay / m.video3s) * 100 : null;

    let status: WeeklyCreativeRow["status"] = "testing";
    if (m.impressions >= minImpr) {
      if (p.leads > 0 && cpl != null && cpl <= cplTarget && p.qualLeads > 0 && cpql != null && cpql <= cpqlTarget) {
        status = "winner";
      } else if ((p.leads > 0 && cpl != null && cpl > cplTarget) || (p.qualLeads > 0 && cpql != null && cpql > cpqlTarget)) {
        status = "loser";
      }
    }

    return {
      adId: m.adId, adName: m.adName, flow: m.flow, format: parts.format,
      thumbnailUrl: asset?.thumbnail_url ?? null,
      assetUrl:     asset?.asset_url ?? asset?.image_url ?? asset?.thumbnail_url ?? null,
      videoId:      asset?.video_id ?? null,
      objectType:   asset?.object_type ?? null,
      spend: m.spend, impressions: m.impressions,
      cpm: div(m.spend, m.impressions) != null ? (m.spend / m.impressions) * 1000 : null,
      clicks: m.clicks,
      cpc: div(m.spend, m.clicks),
      ctr: div(m.clicks, m.impressions) != null ? (m.clicks / m.impressions) * 100 : null,
      crClickLead: div(p.leads, m.clicks) != null ? (p.leads / m.clicks) * 100 : null,
      leads: p.leads, cpl,
      qualLeads: p.qualLeads, cpql,
      hookRate, holdRate,
      status,
    };
  }).sort((a, b) => b.spend - a.spend);

  const label = body.label?.trim() || `${weekStart} – ${weekEnd}`;

  const { data: saved, error: saveErr } = await supabase
    .from("weekly_creative_reports")
    .upsert(
      { week_start: weekStart, week_end: weekEnd, label, rows, created_at: new Date().toISOString() },
      { onConflict: "week_start,week_end" }
    )
    .select("id, created_at, week_start, week_end, label, rows, summary, summary_note, document")
    .single();

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  return NextResponse.json({
    report: {
      id: saved.id, createdAt: saved.created_at,
      weekStart: saved.week_start, weekEnd: saved.week_end,
      label: saved.label, rows: saved.rows,
      summary: saved.summary ?? "", summaryNote: saved.summary_note ?? "",
      document: saved.document ?? "",
    } as WeeklyReport,
    notes: [],
  });
}
