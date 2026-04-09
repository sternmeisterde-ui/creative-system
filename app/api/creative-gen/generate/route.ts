import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase";
import type { Brief, Format } from "@/lib/types";
import {
  findModel,
  DEFAULT_STATIC_MODEL,
  DEFAULT_VIDEO_MODEL,
  TEXT_TO_IMAGE_MODELS,
} from "@/lib/higgsfield-models";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HIGGSFIELD_API    = process.env.HIGGSFIELD_API_URL ?? "https://platform.higgsfield.ai";
const HIGGSFIELD_KEY_ID = process.env.HIGGSFIELD_API_KEY_ID!;
const HIGGSFIELD_SECRET = process.env.HIGGSFIELD_API_KEY_SECRET!;

function isStaticFormat(format: Format): boolean {
  return format === "static";
}

// DB returns snake_case, Brief type uses camelCase — handle both
function getBriefField(brief: Record<string, unknown>, camel: string, snake: string): string {
  return (brief[camel] ?? brief[snake] ?? "") as string;
}

function buildBriefDescription(brief: Record<string, unknown> & { personaName?: string }): string {
  const parts: string[] = [];
  if (brief.personaName) parts.push(`Персона: ${brief.personaName}`);
  const hook = getBriefField(brief, "adaptedHook", "adapted_hook");
  const body = getBriefField(brief, "adaptedBody", "adapted_body");
  const angle = getBriefField(brief, "adaptedAngle", "adapted_angle");
  const full = getBriefField(brief, "fullBrief", "full_brief");
  if (hook)  parts.push(`Хук: ${hook}`);
  if (body)  parts.push(`Боди: ${body}`);
  if (angle) parts.push(`Энгл: ${angle}`);
  if (full)  parts.push(`Полный бриф:\n${full}`);
  return parts.filter(Boolean).join("\n\n");
}

async function applyRevisionToPrompt(existingPrompt: string, revisionNote: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `У тебя есть промт для генерации рекламного креатива (Higgsfield text-to-image/video). Внеси точечные изменения согласно правкам. Сохрани всю остальную структуру промта без изменений. Верни ТОЛЬКО изменённый промт — без пояснений, без кавычек, без вступлений.\n\nОРИГИНАЛЬНЫЙ ПРОМТ:\n${existingPrompt}\n\nПРАВКИ:\n${revisionNote}`,
    }],
  });
  const text = msg.content.find(b => b.type === "text");
  return text?.text?.replace(/"/g, "").replace(/'/g, "").trim() ?? existingPrompt;
}

const MAX_PROMPT_CHARS = 2400; // Kling limit is 2500, leave buffer

async function generatePromptWithClaude(brief: Record<string, unknown> & { personaName?: string }, isStatic: boolean): Promise<string> {
  const briefDesc = buildBriefDescription(brief);
  const modelHint = isStatic ? "nano-banana pro 2" : "Kling video model";
  const formatHint = isStatic ? "static ad banner" : "vertical video ad (9:16)";

  const instruction = isStatic
    ? `Write a concise image generation prompt for ${modelHint} (${formatHint}). Max 2000 characters. English only, include Russian ad text as-is. Cover: background color, layout (TOP/MIDDLE/BOTTOM), fonts, exact Russian text from brief, minimalist high-contrast style. NO quotes. Only the prompt.`
    : `Write a concise video generation prompt for ${modelHint} (${formatHint}). Max 2000 characters. Describe: main character (appearance, emotion), scene/location, action, lighting, camera (handheld iPhone style, no gimbal), dialogue in Russian (no dashes), no on-screen text. NO quotes. Only the prompt.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `${instruction}\n\nBrief:\n${briefDesc}\n\nProduct: SternMeister — accounting courses for Russian-speaking immigrants in Germany.`,
    }],
  });

  const text = msg.content.find(b => b.type === "text");
  const raw = text?.text?.replace(/"/g, "").replace(/'/g, "").trim() ?? briefDesc;
  // Hard-cap at Kling's character limit
  return raw.length > MAX_PROMPT_CHARS ? raw.slice(0, MAX_PROMPT_CHARS) : raw;
}

async function callHiggsfield(slug: string, body: Record<string, unknown>) {
  const endpoint = `${HIGGSFIELD_API}/${slug}`;

  const res = await fetch(endpoint, {
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

  return res.json() as Promise<{ request_id: string; status?: string }>;
}

export async function POST(req: NextRequest) {
  const { briefId, personaName, modelSlug, revisionNote, existingPrompt } = await req.json() as {
    briefId: string;
    personaName?: string;
    modelSlug?: string;
    revisionNote?: string;
    existingPrompt?: string;
  };

  if (!briefId) return NextResponse.json({ error: "briefId required" }, { status: 400 });
  if (!HIGGSFIELD_KEY_ID || !HIGGSFIELD_SECRET) {
    return NextResponse.json({ error: "HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET не настроены" }, { status: 500 });
  }

  const supabase = createServiceClient();

  const { data: brief, error } = await supabase
    .from("briefs").select("*").eq("id", briefId).single();

  if (error || !brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

  const format = brief.format as Format;
  const staticCreative = isStaticFormat(format);

  // Choose model: explicit slug > default by format
  const defaultSlug = staticCreative ? DEFAULT_STATIC_MODEL : DEFAULT_VIDEO_MODEL;
  const slug = modelSlug ?? defaultSlug;
  const modelDef = findModel(slug);

  if (!modelDef) {
    return NextResponse.json({ error: `Unknown model slug: ${slug}` }, { status: 400 });
  }

  // Validate: static format must use text-to-image model
  if (staticCreative && modelDef.category !== "text-to-image") {
    return NextResponse.json({ error: "Static format requires a text-to-image model" }, { status: 400 });
  }
  if (!staticCreative && modelDef.category !== "text-to-video") {
    return NextResponse.json({ error: "Video format requires a text-to-video model" }, { status: 400 });
  }

  const isStaticModel = TEXT_TO_IMAGE_MODELS.some(m => m.slug === slug);

  let prompt: string;
  try {
    if (revisionNote && existingPrompt) {
      // Revision mode: apply changes to existing prompt
      prompt = await applyRevisionToPrompt(existingPrompt, revisionNote);
    } else {
      prompt = await generatePromptWithClaude({ ...(brief as Record<string, unknown>), personaName }, isStaticModel);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Claude prompt error: ${message}` }, { status: 502 });
  }

  const body = modelDef.buildBody(prompt);

  const { data: gen, error: insertErr } = await supabase
    .from("creative_generations")
    .insert({
      brief_id: briefId,
      session_id: brief.session_id,
      format,
      model: slug,
      prompt,
      status: "queued",
      is_static: isStaticModel,
    })
    .select("id").single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  const genId = gen.id as string;

  try {
    const job = await callHiggsfield(slug, body);
    await supabase.from("creative_generations").update({
      higgsfield_job_id: job.request_id,
      status: "processing",
    }).eq("id", genId);
    return NextResponse.json({ ok: true, generationId: genId, model: slug, isStatic: isStaticModel, prompt, jobId: job.request_id });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("creative_generations").update({
      status: "error",
      error_message: message,
    }).eq("id", genId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
