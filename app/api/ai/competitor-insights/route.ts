import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext, getBusiness } from "@/lib/brief";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXCLUDED = ["booking.com", "octopus energy", "alibaba.com"];

type RawRow = Record<string, string>;

function buildAdsText(rows: RawRow[]): string {
  return rows.map((a, i) =>
    `${i + 1}. ${a.page_name} (${parseInt(a.eu_total_reach ?? "0").toLocaleString("de-DE")} охват) | ${a.type ?? ""} | Хук: ${(a.ai_hook ?? "").slice(0, 90)} | Оффер: ${(a.ai_offer ?? "").slice(0, 70)} | УТП: ${(a.ai_utp ?? "").slice(0, 70)} | Психол: ${(a.ai_psychology ?? "").slice(0, 50)}`
  ).join("\n");
}

const BIZ = getBusiness().name;
const CONTEXT = `Стратег Meta Ads.\n\n${getAiContext()}`;

const PARAMS = [
  { key: "hook",    prompt: `Проанализируй только ХУКИ (первые 3 секунды/заголовки). 3 паттерна с примерами из данных + рекомендация для ${BIZ} каждый.` },
  { key: "angle",   prompt: `Проанализируй только ЭНГЛЫ (углы подачи, messaging-стратегии). 3 паттерна с примерами из данных + рекомендация для ${BIZ} каждый.` },
  { key: "persona", prompt: `Проанализируй только ПЕРСОНЫ (типы людей, ситуации, боли в рекламе). 3 паттерна с примерами из данных + рекомендация для ${BIZ} каждый.` },
  { key: "body",    prompt: `Проанализируй только БОДИ (структура основной части, аргументы, длина). 3 паттерна с примерами из данных + рекомендация для ${BIZ} каждый.` },
] as const;

async function analyzeParam(param: typeof PARAMS[number], adsText: string): Promise<string> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: `${CONTEXT}\n\nТоп-20 объявлений конкурентов:\n${adsText}\n\n${param.prompt}\n\nОтвечай без markdown-заголовков, только текст.`,
    }],
  });
  return (msg.content[0] as { type: string; text: string }).text.trim();
}

export async function POST() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("competitor_concepts")
    .select("raw_data")
    .not("raw_data", "is", null)
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? [])
    .map(r => r.raw_data as RawRow)
    .filter(r => r?.page_name && !EXCLUDED.some(e => r.page_name!.toLowerCase().includes(e)))
    .sort((a, b) => parseInt(b.eu_total_reach ?? "0") - parseInt(a.eu_total_reach ?? "0"))
    .slice(0, 20);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Нет данных" }, { status: 400 });
  }

  const adsText = buildAdsText(rows);

  const [hook, angle, persona, body] = await Promise.all(
    PARAMS.map(p => analyzeParam(p, adsText))
  );

  return NextResponse.json({ ok: true, insights: { hook, angle, persona, body } });
}
