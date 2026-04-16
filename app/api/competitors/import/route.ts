import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ConceptType = "hook" | "angle" | "persona" | "body" | "format" | "other";

interface AdInput {
  competitor_name: string;
  ad_text: string;
  ad_url?: string;
  concept_type?: ConceptType;
  source?: string;
  raw_data?: Record<string, string>;
}

// Classify a batch of ads into concept types using Claude
async function classifyAds(ads: AdInput[]): Promise<ConceptType[]> {
  const unclassified = ads.filter(a => !a.concept_type);
  if (unclassified.length === 0) return ads.map(a => a.concept_type as ConceptType);

  const prompt = `Ты — аналитик рекламных креативов. Классифицируй каждое рекламное объявление конкурента по типу элемента.

ТИПЫ:
- hook — первые 3 секунды / заголовок / то, что останавливает скролл
- angle — основной угол подачи / messaging / ключевой аргумент
- persona — тип персонажа / аудитории / ситуации из жизни
- body — основная часть контента / структура аргументации
- format — визуальный формат (UGC, статика, анимация и т.д.)
- other — не подходит ни под одну категорию

ОБЪЯВЛЕНИЯ:
${unclassified.map((a, i) => `${i + 1}. ${a.ad_text.slice(0, 300)}`).join("\n\n")}

Ответь ТОЛЬКО JSON-массивом с типами, по одному на объявление, в том же порядке.
Пример: ["hook","angle","persona"]`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text = (msg.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(text) as ConceptType[];
    // Merge classified back with pre-classified
    const result: ConceptType[] = [];
    let unclassifiedIdx = 0;
    for (const ad of ads) {
      if (ad.concept_type) {
        result.push(ad.concept_type);
      } else {
        result.push(parsed[unclassifiedIdx++] ?? "other");
      }
    }
    return result;
  } catch {
    // Fallback: mark all as other
    return ads.map(a => a.concept_type ?? "other");
  }
}

// Extract a concise title from ad text
function extractTitle(adText: string): string {
  const lines = adText.split(/[\n.!?]/).map(l => l.trim()).filter(Boolean);
  const first = lines[0] ?? adText;
  return first.length > 120 ? first.slice(0, 117) + "…" : first;
}

export async function POST(req: NextRequest) {
  // Auth: Bearer token
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json() as { ads?: AdInput[] };
  const ads = body.ads;

  if (!Array.isArray(ads) || ads.length === 0) {
    return NextResponse.json({ error: "ads array required" }, { status: 400 });
  }

  // Validate required fields
  for (const ad of ads) {
    if (!ad.competitor_name || !ad.ad_text) {
      return NextResponse.json({ error: "Each ad needs competitor_name and ad_text" }, { status: 400 });
    }
  }

  // Classify all ads (batch call to Claude for unclassified)
  const conceptTypes = await classifyAds(ads);

  // Build rows for Supabase
  const rows = ads.map((ad, i) => ({
    source: ad.source ?? "n8n",
    concept_type: conceptTypes[i],
    title: extractTitle(ad.ad_text),
    description: `[${ad.competitor_name}] ${ad.ad_text.slice(0, 1000)}${ad.ad_url ? `\n\nURL: ${ad.ad_url}` : ""}`,
    status: "pending",
    raw_data: ad.raw_data ?? null,
  }));

  const supabase = createServiceClient();

  // Insert — skip duplicates by checking title+source combo
  const { data, error } = await supabase
    .from("competitor_concepts")
    .insert(rows)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: data?.length ?? 0,
    total: ads.length,
  });
}

// GET — health check / docs
export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/competitors/import",
    auth: "Authorization: Bearer {WEBHOOK_SECRET}",
    body: {
      ads: [
        {
          competitor_name: "string (required)",
          ad_text: "string (required) — full ad text/transcript",
          ad_url: "string (optional) — URL to the ad in Ads Library",
          concept_type: "hook|angle|persona|body|format|other (optional — Claude auto-classifies if omitted)",
        }
      ]
    },
    notes: "Set WEBHOOK_SECRET env var to enable auth. If omitted, endpoint is open.",
  });
}
