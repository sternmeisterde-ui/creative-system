import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase";

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EL_KEY       = process.env.ELEVENLABS_API_KEY!;
const EL_VOICE_ID  = process.env.ELEVENLABS_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9";
const STORAGE_BUCKET = "scene-audio";

async function ensureBucket(supabase: ReturnType<typeof createServiceClient>) {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === STORAGE_BUCKET)) {
    await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
  }
}

async function extractDialogue(scenePrompt: string, briefContext: string, sceneIndex: number): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Напиши ОЧЕНЬ короткий русский монолог (8–12 секунд = 25–35 слов) для персонажа в сцене ${sceneIndex} рекламного видео.

Правила:
- Живой разговорный русский, без канцелярщины
- Персонаж обращается к зрителю напрямую
- Текст должен логично вытекать из хука/боди/энгла брифа
- Без вступлений типа "Привет, я..." — сразу в суть
- Слово "ШтернМастер" произносится как есть
- СТРОГО не более 35 слов
- Вернуть ТОЛЬКО текст монолога, без пояснений

Описание сцены (промпт): ${scenePrompt}

Контекст брифа:
${briefContext}`,
    }],
  });
  const text = msg.content.find(b => b.type === "text")?.text ?? "";
  return text.trim();
}

type WordTimestamp = { text: string; start: number; end: number };

interface ElLabsTimestampsResponse {
  audio_base64: string;
  normalized_alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

async function generateAudio(text: string, voiceId: string): Promise<{
  audioBuffer: Buffer;
  wordTimestamps: WordTimestamp[];
  audioDuration: number;
}> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = await res.json() as ElLabsTimestampsResponse;
  const audioBuffer = Buffer.from(json.audio_base64, "base64");

  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } =
    json.normalized_alignment;

  // Group characters into words
  const wordTimestamps: WordTimestamp[] = [];
  let wordChars: string[] = [];
  let wordStart = 0;
  let wordEnd = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " " || ch === "\n") {
      if (wordChars.length > 0) {
        wordTimestamps.push({ text: wordChars.join(""), start: wordStart, end: wordEnd });
        wordChars = [];
      }
    } else {
      if (wordChars.length === 0) wordStart = starts[i];
      wordChars.push(ch);
      wordEnd = ends[i];
    }
  }
  if (wordChars.length > 0) {
    wordTimestamps.push({ text: wordChars.join(""), start: wordStart, end: wordEnd });
  }

  const audioDuration = ends.length > 0 ? ends[ends.length - 1] + 0.3 : 0; // +0.3s tail buffer

  return { audioBuffer, wordTimestamps, audioDuration };
}

// POST /api/creative-gen/generate-voices
export async function POST(req: NextRequest) {
  const { sceneGroupId, voiceId } = await req.json() as { sceneGroupId: string; voiceId?: string };
  if (!sceneGroupId) return NextResponse.json({ error: "sceneGroupId required" }, { status: 400 });
  if (!EL_KEY) return NextResponse.json({ error: "ELEVENLABS_API_KEY не настроен" }, { status: 500 });
  const resolvedVoiceId = voiceId ?? EL_VOICE_ID;

  const supabase = createServiceClient();
  await ensureBucket(supabase);

  const { data: group } = await supabase
    .from("creative_scene_groups").select("*, briefs:brief_id(*)").eq("id", sceneGroupId).single();
  if (!group) return NextResponse.json({ error: "Scene group not found" }, { status: 404 });

  const brief = group.briefs as Record<string, string> | null;
  const briefContext = [
    brief?.adapted_hook  ? `Хук: ${brief.adapted_hook}`  : "",
    brief?.adapted_body  ? `Боди: ${brief.adapted_body}`  : "",
    brief?.adapted_angle ? `Энгл: ${brief.adapted_angle}` : "",
  ].filter(Boolean).join("\n");

  // Only process scenes that don't have audio yet (allows retry for partial failures)
  const { data: scenes } = await supabase
    .from("creative_generations")
    .select("id, scene_index, prompt, status")
    .eq("scene_group_id", sceneGroupId)
    .eq("status", "done")
    .is("audio_url", null)
    .order("scene_index", { ascending: true });

  if (!scenes?.length) return NextResponse.json({ ok: true, succeeded: 0, failed: 0, message: "Все сцены уже обработаны" });

  type Scene = NonNullable<typeof scenes>[number];
  async function processScene(scene: Scene) {
    const dialogue = await extractDialogue(scene.prompt ?? "", briefContext, scene.scene_index ?? 0);
    const { audioBuffer, wordTimestamps, audioDuration } = await generateAudio(dialogue, resolvedVoiceId);

    const filePath = `${sceneGroupId}/${scene.id}.mp3`;
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, audioBuffer, { contentType: "audio/mpeg", upsert: true });

    if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`);

    const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);

    await supabase.from("creative_generations").update({
      dialogue,
      audio_url: publicUrl,
      word_timestamps: wordTimestamps,
      audio_duration: audioDuration,
    }).eq("id", scene.id);

    return { sceneId: scene.id, sceneIndex: scene.scene_index };
  }

  // First pass
  const results = await Promise.allSettled(scenes.map(scene => processScene(scene)));

  // Retry failed scenes once after 2 seconds
  const failedScenes = scenes.filter((_, i) => results[i].status === "rejected");
  let retrySucceeded = 0;
  if (failedScenes.length > 0) {
    await new Promise(r => setTimeout(r, 2000));
    const retryResults = await Promise.allSettled(failedScenes.map(scene => processScene(scene)));
    retrySucceeded = retryResults.filter(r => r.status === "fulfilled").length;
  }

  const succeeded = results.filter(r => r.status === "fulfilled").length + retrySucceeded;
  const failed    = failedScenes.length - retrySucceeded;

  if (succeeded > 0) {
    await supabase.from("creative_scene_groups")
      .update({ voiceover_done: true })
      .eq("id", sceneGroupId);
  }

  return NextResponse.json({ ok: true, succeeded, failed });
}
