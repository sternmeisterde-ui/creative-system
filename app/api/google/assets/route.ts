import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { isPlatformConfigured } from "@/lib/platforms";
import { googleAdsSearch, GOOGLE_CUSTOMER_ID } from "@/lib/google-ads";

// ── Google Ads creative assets ───────────────────────────────────────────────
// Тянет ВИЗУАЛЬНЫЕ ассеты (IMAGE + YOUTUBE_VIDEO) из PMax (asset_group_asset),
// с привязкой к кампании, дедуп по asset.id, кладёт в meta_creatives
// (platform='google'). Это сырьё для маппинга крео Google на коды P·H·B·A.
//
// ВАЖНО: PMax не отдаёт метрики по ассетам — это каталог крео, не перформанс.
// Текстовые ассеты (HEADLINE/DESCRIPTION) пропускаем — маппим только визуал.
export const maxDuration = 120;

interface AssetRow {
  campaign?: { name?: string };
  assetGroup?: { name?: string };
  assetGroupAsset?: { fieldType?: string };
  asset?: {
    id?: string;
    name?: string;
    type?: string;
    imageAsset?: { fullSize?: { url?: string } };
    youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string };
  };
}

function flowFromCampaign(name: string): "com" | "gov" | null {
  const n = name.toLowerCase();
  if (n.includes("gov")) return "gov";
  if (n.includes("comm")) return "com";
  return null;
}

export async function POST() {
  if (!isPlatformConfigured("google")) {
    return NextResponse.json({ error: "Google Ads не настроен." }, { status: 503 });
  }

  const query = `
    SELECT campaign.name, asset_group.name, asset_group_asset.field_type,
           asset.id, asset.name, asset.type,
           asset.image_asset.full_size.url,
           asset.youtube_video_asset.youtube_video_id,
           asset.youtube_video_asset.youtube_video_title
    FROM asset_group_asset
    WHERE asset.type IN ('IMAGE', 'YOUTUBE_VIDEO')`;

  let rows: AssetRow[];
  try {
    rows = await googleAdsSearch(query) as AssetRow[];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Дедуп по asset.id (ассет живёт в нескольких asset_group/кампаниях).
  const byId = new Map<string, Record<string, unknown>>();
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const a = r.asset ?? {};
    const id = String(a.id ?? "");
    if (!id || byId.has(id)) continue;
    const isVideo = a.type === "YOUTUBE_VIDEO";
    const ytId = a.youtubeVideoAsset?.youtubeVideoId;
    const imgUrl = a.imageAsset?.fullSize?.url;
    const thumb = isVideo
      ? (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null)
      : (imgUrl ?? null);
    if (!thumb) continue; // без превью маппить нечего
    byType[a.type ?? "?"] = (byType[a.type ?? "?"] ?? 0) + 1;

    const campName = r.campaign?.name ?? "";
    const label = a.name || a.youtubeVideoAsset?.youtubeVideoTitle
      || `${r.assetGroupAsset?.fieldType ?? a.type} ${id}`;

    byId.set(id, {
      ad_id:        `gasset:${id}`,
      ad_name:      label,
      flow:         flowFromCampaign(campName),
      object_type:  isVideo ? "VIDEO" : "IMAGE",
      thumbnail_url: thumb,
      image_url:    isVideo ? null : imgUrl,
      video_id:     isVideo ? ytId : null,
      asset_url:    thumb,
      platform:     "google",
    });
  }

  const assets = Array.from(byId.values());
  const supabase = createServiceClient();

  // Полная замена google-ассетов (свежий каталог).
  await supabase.from("meta_creatives").delete().eq("platform", "google");
  let err: string | null = null;
  if (assets.length) {
    const { error } = await supabase.from("meta_creatives").upsert(assets, { onConflict: "ad_id" });
    err = error?.message ?? null;
  }

  return NextResponse.json({
    ok: !err,
    platform: "google",
    account: GOOGLE_CUSTOMER_ID,
    fetchedRows: rows.length,
    uniqueAssets: assets.length,
    byType,
    error: err,
  });
}

export async function GET() {
  return POST();
}
