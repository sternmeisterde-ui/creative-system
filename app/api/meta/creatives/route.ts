import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getMetaAccountsMap } from "@/lib/brief";

// Ингест ассетов креативов из Meta (для последующего Gemini-разбора).
// Тянет creative{thumbnail_url,image_url,video_id,object_type} по всем объявлениям
// аккаунта, кладёт в meta_creatives (грань = ad_id). video source НЕ резолвим здесь —
// это делает этап Gemini по video_id (чтобы не молотить per-video запросы на ингесте).
export const maxDuration = 300;

const TOKEN = process.env.META_ACCESS_TOKEN!;
const ACCOUNTS = getMetaAccountsMap();

interface MetaAd {
  id: string;
  name?: string;
  creative?: { id?: string; thumbnail_url?: string; image_url?: string; video_id?: string; object_type?: string };
}

async function fetchAccountCreatives(accountId: string): Promise<MetaAd[]> {
  const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/ads`);
  url.searchParams.set("access_token", TOKEN);
  url.searchParams.set("fields", "id,name,creative{id,thumbnail_url,image_url,video_id,object_type}");
  url.searchParams.set("limit", "200");

  const all: MetaAd[] = [];
  let nextUrl: string | null = url.toString();
  // Защита от бесконечной пагинации (большие аккаунты).
  for (let page = 0; nextUrl && page < 50; page++) {
    const res = await fetch(nextUrl);
    const json = await res.json() as { data?: MetaAd[]; paging?: { next?: string }; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    all.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }
  return all;
}

export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: "META_ACCESS_TOKEN не задан" }, { status: 503 });
  const supabase = createServiceClient();
  const results: { flow: string; ads: number; withAsset: number; error?: string }[] = [];

  for (const [flow, accountId] of Object.entries(ACCOUNTS)) {
    try {
      const ads = await fetchAccountCreatives(accountId);
      const rows = ads.map(a => {
        const c = a.creative ?? {};
        const assetUrl = c.image_url || c.thumbnail_url || null; // для видео — превью; полный source резолвит Gemini-этап по video_id
        return {
          ad_id:         a.id,
          ad_name:       a.name ?? "",
          flow,
          object_type:   c.object_type ?? null,
          thumbnail_url: c.thumbnail_url ?? null,
          image_url:     c.image_url ?? null,
          video_id:      c.video_id ?? null,
          asset_url:     assetUrl,
          fetched_at:    new Date().toISOString(),
        };
      });
      if (rows.length > 0) {
        const { error } = await supabase.from("meta_creatives").upsert(rows, { onConflict: "ad_id" });
        if (error) throw new Error(error.message);
      }
      results.push({ flow, ads: rows.length, withAsset: rows.filter(r => r.asset_url || r.video_id).length });
    } catch (e) {
      results.push({ flow, ads: 0, withAsset: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return POST(new NextRequest("http://localhost/api/meta/creatives", { method: "POST", body: "{}" }));
}
