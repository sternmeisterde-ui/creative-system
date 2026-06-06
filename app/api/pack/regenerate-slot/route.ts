/**
 * POST /api/pack/regenerate-slot
 *
 * Перегенерация одного слота в выданном паке.
 * Сохраняет категорию слота (winner_family / winner_mix / discovery / competitor),
 * меняет только конкретный slot_id внутри pack_metadata.slots[].
 *
 * Body: { sessionId: string, slotId: number }
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAiContext, getBusiness } from "@/lib/brief";
import { getSettings } from "@/lib/settings";
import type { PackMetadata, PackSlot } from "@/lib/types";

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RequestBody {
  sessionId: string;
  slotId:    number;
}

export async function POST(req: NextRequest) {
  const { sessionId, slotId } = (await req.json()) as RequestBody;
  if (!sessionId || slotId == null) {
    return NextResponse.json({ error: "sessionId и slotId обязательны" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const settings = await getSettings();

  // Загружаем текущий pack
  const { data: session, error: sessErr } = await supabase
    .from("constructor_sessions")
    .select("id, flow, format, pack_metadata")
    .eq("id", sessionId)
    .single();
  if (sessErr || !session?.pack_metadata) {
    return NextResponse.json({ error: "Session не найдена или без pack_metadata" }, { status: 404 });
  }

  const meta = session.pack_metadata as PackMetadata;
  const slot = meta.slots.find(s => s.slotId === slotId);
  if (!slot) {
    return NextResponse.json({ error: `Slot #${slotId} не найден в паке` }, { status: 404 });
  }

  // Загружаем библиотеку (для prompt'а)
  const [pRes, hRes, bRes, aRes] = await Promise.all([
    supabase.from("personas").select("code, name").not("code", "is", null),
    supabase.from("hooks").select("code, name").not("code", "is", null),
    supabase.from("bodies").select("code, name").not("code", "is", null),
    supabase.from("angles").select("code, name").not("code", "is", null),
  ]);

  // Уже использованные комбинации в паке — чтобы не повторяться
  const usedCombos = new Set(
    meta.slots
      .filter(s => s.slotId !== slotId)
      .map(s => `${s.codes.persona}|${s.codes.hook}|${s.codes.body}|${s.codes.angle}`)
  );

  const codesBlock = (rows: Array<{ code: string | null; name: string }>) =>
    rows.map(r => `  ${r.code}: ${r.name}`).join("\n");

  const prompt = `Ты — стратег рекламных креативов Meta Ads.

${getBusiness().name}
${getAiContext()}

Цели: CPL ≤ €${settings.cplTarget}, CPQL ≤ €${settings.cpqlTarget}.
Поток: ${meta.flow.toUpperCase()} · Формат: ${meta.format.toUpperCase()}

ЗАДАЧА: перегенерируй ТОЛЬКО один слот пака с сохранением его категории.

Категория слота: ${slot.category}
Текущее содержимое (мы его выкидываем):
  codes: P=${slot.codes.persona ?? "?"} H=${slot.codes.hook ?? "?"} B=${slot.codes.body ?? "?"} A=${slot.codes.angle ?? "?"}
  rationale: ${slot.rationale}
${slot.basedOnAd ? `  based_on_ad: ${slot.basedOnAd}\n` : ""}${slot.fromWinners?.length ? `  from_winners: ${slot.fromWinners.join(", ")}\n` : ""}

УЖЕ ИСПОЛЬЗОВАННЫЕ КОМБИНАЦИИ В ПАКЕ (избегай повтора):
${Array.from(usedCombos).slice(0, 20).map(c => `  ${c}`).join("\n") || "  (нет)"}

## БИБЛИОТЕКА КОДОВ
Персоны:
${codesBlock((pRes.data ?? []) as Array<{ code: string | null; name: string }>)}
Хуки:
${codesBlock((hRes.data ?? []) as Array<{ code: string | null; name: string }>)}
Боди:
${codesBlock((bRes.data ?? []) as Array<{ code: string | null; name: string }>)}
Энглы:
${codesBlock((aRes.data ?? []) as Array<{ code: string | null; name: string }>)}

ПРАВИЛА:
- Сохрани категорию слота: ${slot.category}
- Используй существующие коды из библиотеки (НЕ создавай новые — это слот-регенерация, не новый concept)
- Комбинация должна отличаться от уже использованных в паке

Верни СТРОГО JSON, без markdown:
{
  "slot_id": ${slotId},
  "category": "${slot.category}",
  "codes": { "persona": "P?", "hook": "H?", "body": "B?", "angle": "A?" },
  "rationale": "короткое объяснение почему эта комбинация"${slot.category === "winner_family" ? ',\n  "based_on_ad": "ad_name", "varied_param": "persona|hook|body|angle"' : ""}${slot.category === "winner_mix" ? ',\n  "from_winners": ["ad_name1", "ad_name2"]' : ""}${slot.category === "discovery" ? ',\n  "helps_codes": ["H3", "B4"]' : ""}
}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = (msg.content[0] as { type: string; text: string }).text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: `Claude вернул не-JSON: ${text.slice(0, 500)}` }, { status: 502 });
  }

  let newSlot: Record<string, unknown>;
  try {
    newSlot = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return NextResponse.json({ error: `JSON parse fail: ${(e as Error).message}` }, { status: 502 });
  }

  // Обновляем pack_metadata
  const updatedSlot: PackSlot = {
    slotId,
    category: slot.category,
    codes: (newSlot.codes ?? slot.codes) as PackSlot["codes"],
    rationale: String(newSlot.rationale ?? slot.rationale),
    basedOnAd: newSlot.based_on_ad as string | undefined,
    variedParam: newSlot.varied_param as PackSlot["variedParam"],
    fromWinners: newSlot.from_winners as string[] | undefined,
    helpsCodes: newSlot.helps_codes as string[] | undefined,
    sourceConceptId: slot.sourceConceptId,        // сохраняем для competitor
    newCodesCreated: slot.newCodesCreated,        // сохраняем для competitor
  };

  const updatedMeta: PackMetadata = {
    ...meta,
    slots: meta.slots.map(s => s.slotId === slotId ? updatedSlot : s),
  };

  const { error: updErr } = await supabase
    .from("constructor_sessions")
    .update({ pack_metadata: updatedMeta })
    .eq("id", sessionId);

  if (updErr) {
    return NextResponse.json({ error: `DB update error: ${updErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, slot: updatedSlot });
}
