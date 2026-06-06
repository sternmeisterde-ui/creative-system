import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase";
import { findModel, DEFAULT_VIDEO_MODEL } from "@/lib/higgsfield-models";
import { brief as briefConfig } from "@/lib/brief";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HIGGSFIELD_API    = process.env.HIGGSFIELD_API_URL ?? "https://platform.higgsfield.ai";
const HIGGSFIELD_KEY_ID = process.env.HIGGSFIELD_API_KEY_ID!;
const HIGGSFIELD_SECRET = process.env.HIGGSFIELD_API_KEY_SECRET!;

const MAX_SCENE_PROMPT_CHARS = 2400;

interface SceneData {
  index: number;
  description: string;
  prompt: string;
}

async function extractScenes(fullBrief: string): Promise<SceneData[]> {
  // ВСЁ на языке brief.language (включая prompts для Kling).
  // Kling 2.6 Pro обрабатывает русский, но менее стабильно — пользователь готов на компромисс.
  const lang = briefConfig.business.language;
  const dialogueRules = briefConfig.brand_voice.dialogue_rules ?? [];
  const dialogueBlock = dialogueRules.length > 0
    ? `\nПравила диалогов:\n${dialogueRules.map(r => `  - ${r}`).join("\n")}`
    : "";

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `Извлеки сцены из креативного брифа. Верни ТОЛЬКО валидный JSON-массив без markdown.

Каждый элемент: {"index": number, "description": "короткое описание сцены", "prompt": "Kling-промпт на языке '${lang}' максимум 400 символов"}

Правила Kling-промптов (ВСЁ на языке '${lang}', никаких других языков):
- Эстетика iPhone 15 Pro Max: handheld, без gimbal, естественный grain, 9:16 vertical
- Опиши: внешность/эмоцию персонажа, локацию, действие, свет, движение камеры
- Длительность 10 секунд
- Диалог (если есть) — на языке '${lang}', без тире, без экранного текста
- Никакого on-screen-текста, никаких subtitle/supers${dialogueBlock}

Извлекай сцены из секции ПОКАДРОВЫЙ ПЛАН или СЦЕНАРИЙ. На каждую сцену — один Kling-промпт.
До 6 сцен (бриф может покрывать 30-60 сек видео).

Бриф:
${fullBrief}

Верни ТОЛЬКО: [{"index":1,"description":"...","prompt":"..."},...]`,
    }],
  });

  const text = msg.content.find(b => b.type === "text")?.text ?? "[]";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const scenes = JSON.parse(match[0]) as SceneData[];
    return scenes.map(s => ({
      ...s,
      prompt: s.prompt.length > MAX_SCENE_PROMPT_CHARS
        ? s.prompt.slice(0, MAX_SCENE_PROMPT_CHARS)
        : s.prompt,
    }));
  } catch {
    return [];
  }
}

async function submitToHiggsfield(slug: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${HIGGSFIELD_API}/${slug}`, {
    method: "POST",
    headers: {
      "hf-api-key": HIGGSFIELD_KEY_ID,
      "hf-secret": HIGGSFIELD_SECRET,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Higgsfield ${res.status}: ${err}`);
  }
  const data = await res.json() as { request_id: string };
  return data.request_id;
}

// POST /api/creative-gen/generate-scenes
export async function POST(req: NextRequest) {
  const { briefId, personaName, modelSlug } = await req.json() as {
    briefId: string;
    personaName?: string;
    modelSlug?: string;
  };

  if (!briefId) return NextResponse.json({ error: "briefId required" }, { status: 400 });
  if (!HIGGSFIELD_KEY_ID || !HIGGSFIELD_SECRET) {
    return NextResponse.json({ error: "HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET не настроены" }, { status: 500 });
  }

  const supabase = createServiceClient();

  const { data: brief, error: briefErr } = await supabase
    .from("briefs").select("*").eq("id", briefId).single();
  if (briefErr || !brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

  const slug = modelSlug ?? DEFAULT_VIDEO_MODEL;
  const modelDef = findModel(slug);
  if (!modelDef) return NextResponse.json({ error: `Unknown model slug: ${slug}` }, { status: 400 });
  if (modelDef.category !== "text-to-video") {
    return NextResponse.json({ error: "Scene generation requires a text-to-video model" }, { status: 400 });
  }

  const fullBrief = (brief.full_brief ?? "") as string;
  const briefContext = [
    personaName ? `Персона: ${personaName}` : "",
    brief.adapted_hook ? `Хук: ${brief.adapted_hook}` : "",
    brief.adapted_body ? `Боди: ${brief.adapted_body}` : "",
    fullBrief,
  ].filter(Boolean).join("\n\n");

  let scenes: SceneData[];
  try {
    scenes = await extractScenes(briefContext);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Scene extraction failed: ${message}` }, { status: 502 });
  }

  if (scenes.length === 0) {
    return NextResponse.json({ error: "Не удалось извлечь сцены из брифа" }, { status: 422 });
  }

  // Create scene group
  const { data: group, error: groupErr } = await supabase
    .from("creative_scene_groups")
    .insert({
      brief_id: brief.id,
      session_id: brief.session_id,
      format: brief.format,
      model: slug,
      scene_count: scenes.length,
      status: "generating",
    })
    .select("id").single();

  if (groupErr || !group) {
    return NextResponse.json({ error: groupErr?.message ?? "Failed to create scene group" }, { status: 500 });
  }

  const sceneGroupId = group.id as string;

  // Submit each scene to Higgsfield in parallel
  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      const body = modelDef.buildBody(scene.prompt);

      // Insert generation record
      const { data: gen, error: insertErr } = await supabase
        .from("creative_generations")
        .insert({
          brief_id: briefId,
          session_id: brief.session_id,
          format: brief.format,
          model: slug,
          prompt: scene.prompt,
          is_static: false,
          status: "queued",
          scene_group_id: sceneGroupId,
          scene_index: scene.index,
        })
        .select("id").single();

      if (insertErr || !gen) throw new Error(insertErr?.message ?? "insert failed");
      const genId = gen.id as string;

      try {
        const jobId = await submitToHiggsfield(slug, body);
        await supabase.from("creative_generations").update({
          higgsfield_job_id: jobId,
          status: "processing",
        }).eq("id", genId);
        return { genId, jobId, sceneIndex: scene.index };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        await supabase.from("creative_generations").update({
          status: "error",
          error_message: message,
        }).eq("id", genId);
        throw e;
      }
    })
  );

  const succeeded = results.filter(r => r.status === "fulfilled").length;
  const failed    = results.filter(r => r.status === "rejected").length;

  if (succeeded === 0) {
    await supabase.from("creative_scene_groups").update({
      status: "error",
      error_message: "Все сцены завершились с ошибкой",
    }).eq("id", sceneGroupId);
    return NextResponse.json({ error: "All scene submissions failed" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    sceneGroupId,
    sceneCount: scenes.length,
    succeeded,
    failed,
    scenes: scenes.map(s => ({ index: s.index, description: s.description })),
  });
}
