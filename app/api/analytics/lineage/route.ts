import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export interface AdLineage {
  adName: string;
  flow: string | null;
  spend: number;
  impressions: number;
  cpl: number | null;
  cpql: number | null;
  autoStatus: string;
}

export interface BriefLineage {
  id: string;
  adName: string | null;   // naming convention ad name after publish
  status: string;
  performance: AdLineage | null;
}

export interface SessionLineage {
  id: string;
  name: string;
  flow: string | null;
  status: string;
  createdAt: string;
  selectedPersonas: string[];
  selectedHooks: string[];
  selectedBodies: string[];
  selectedAngles: string[];
  totalBriefs: number;
  approvedBriefs: number;
  publishedAds: number;
  winners: number;
  fakeWinners: number;
  losers: number;
  totalSpend: number;
  avgCpl: number | null;
  briefs: BriefLineage[];
}

export async function GET() {
  const supabase = createServiceClient();

  // Fetch sessions
  const { data: sessions } = await supabase
    .from("constructor_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!sessions?.length) return NextResponse.json({ ok: true, sessions: [] });

  // Fetch all briefs for these sessions
  const sessionIds = sessions.map(s => s.id as string);
  const { data: briefs } = await supabase
    .from("briefs")
    .select("id, session_id, status, meta_ad_name")
    .in("session_id", sessionIds);

  // Fetch performance for all published ad names
  const publishedAdNames = (briefs ?? [])
    .map(b => b.meta_ad_name as string | null)
    .filter(Boolean) as string[];

  let perfMap: Record<string, AdLineage> = {};
  if (publishedAdNames.length > 0) {
    const { data: perf } = await supabase
      .from("creative_performance")
      .select("ad_name, flow, spend, impressions, cpl, cpql, auto_status")
      .in("ad_name", publishedAdNames);

    perfMap = Object.fromEntries(
      (perf ?? []).map(p => [p.ad_name as string, {
        adName:      p.ad_name as string,
        flow:        p.flow as string | null,
        spend:       parseFloat(p.spend ?? 0),
        impressions: parseInt(p.impressions ?? 0),
        cpl:         p.cpl as number | null,
        cpql:        p.cpql as number | null,
        autoStatus:  p.auto_status as string,
      }])
    );
  }

  // Build lineage per session
  const result: SessionLineage[] = sessions.map(s => {
    const sessionBriefs = (briefs ?? []).filter(b => b.session_id === s.id);
    const approved = sessionBriefs.filter(b => b.status === "approved");
    const published = sessionBriefs.filter(b => b.meta_ad_name);

    const publishedPerf = published
      .map(b => b.meta_ad_name ? perfMap[b.meta_ad_name] : null)
      .filter(Boolean) as AdLineage[];

    const winners     = publishedPerf.filter(p => p.autoStatus === "winner").length;
    const fakeWinners = publishedPerf.filter(p => p.autoStatus === "fake_winner").length;
    const losers      = publishedPerf.filter(p => p.autoStatus === "loser").length;
    const totalSpend  = publishedPerf.reduce((sum, p) => sum + p.spend, 0);

    const withLeads = publishedPerf.filter(p => p.cpl != null);
    const avgCpl = withLeads.length > 0
      ? withLeads.reduce((sum, p) => sum + (p.cpl ?? 0), 0) / withLeads.length
      : null;

    // Decode selectedPersonas etc. from JSON columns
    const decode = (v: unknown): string[] => {
      if (Array.isArray(v)) return v as string[];
      if (typeof v === "string") { try { return JSON.parse(v); } catch { return []; } }
      return [];
    };

    return {
      id:               s.id as string,
      name:             (s.name as string) || "Без названия",
      flow:             s.flow as string | null,
      status:           s.status as string,
      createdAt:        s.created_at as string,
      selectedPersonas: decode(s.selected_personas),
      selectedHooks:    decode(s.selected_hooks),
      selectedBodies:   decode(s.selected_bodies),
      selectedAngles:   decode(s.selected_angles),
      totalBriefs:      sessionBriefs.length,
      approvedBriefs:   approved.length,
      publishedAds:     published.length,
      winners,
      fakeWinners,
      losers,
      totalSpend:       Math.round(totalSpend * 100) / 100,
      avgCpl:           avgCpl != null ? Math.round(avgCpl * 100) / 100 : null,
      briefs: sessionBriefs.map(b => ({
        id:          b.id as string,
        adName:      b.meta_ad_name as string | null,
        status:      b.status as string,
        performance: b.meta_ad_name ? (perfMap[b.meta_ad_name] ?? null) : null,
      })),
    };
  });

  return NextResponse.json({ ok: true, sessions: result });
}
