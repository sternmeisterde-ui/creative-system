import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const CREATOMATE_API = "https://api.creatomate.com/v1";
const CREATOMATE_KEY = process.env.CREATOMATE_API_KEY!;

const WORDS_PER_PHRASE = 3;

type WordTimestamp = { text: string; start: number; end: number };

type Scene = {
  scene_index: number | null;
  result_url: string | null;
  lipsynced_url: string | null;
  dialogue: string | null;
  word_timestamps: WordTimestamp[] | null;
  audio_duration: number | null;
};

type CreatomateElement = Record<string, unknown>;

function buildVideoElements(scenes: Scene[]): CreatomateElement[] {
  return scenes.map(s => ({
    type: "video",
    track: 1,
    source: (s.lipsynced_url ?? s.result_url) as string,
  }));
}

function buildSubtitleElements(scenes: Scene[]): CreatomateElement[] {
  const elements: CreatomateElement[] = [];
  let timeOffset = 0;

  for (const scene of scenes) {
    const words = scene.word_timestamps;
    const duration = scene.audio_duration ?? 0;

    if (words && words.length > 0) {
      // Group into phrases of WORDS_PER_PHRASE
      for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
        const chunk = words.slice(i, i + WORDS_PER_PHRASE);
        const phraseText = chunk.map(w => w.text).join(" ");
        const phraseStart = timeOffset + chunk[0].start;
        const phraseEnd = timeOffset + chunk[chunk.length - 1].end;

        elements.push({
          type: "text",
          track: 2,
          time: Math.round(phraseStart * 1000) / 1000,
          duration: Math.max(0.15, Math.round((phraseEnd - chunk[0].start) * 1000) / 1000),
          text: phraseText,
          font_family: "Montserrat",
          font_weight: "700",
          font_size: "7.5vmin",
          fill_color: "#FFFFFF",
          stroke_color: "#000000",
          stroke_width: "0.6vmin",
          x_anchor: "50%",
          y_anchor: "87%",
          width: "88%",
          text_align: "center",
        });
      }
    }

    timeOffset += duration;
  }

  return elements;
}

// POST /api/creative-gen/stitch-scenes
export async function POST(req: NextRequest) {
  const { sceneGroupId } = await req.json() as { sceneGroupId: string };
  if (!sceneGroupId) return NextResponse.json({ error: "sceneGroupId required" }, { status: 400 });
  if (!CREATOMATE_KEY) return NextResponse.json({ error: "CREATOMATE_API_KEY не настроен" }, { status: 500 });

  const supabase = createServiceClient();

  const { data: group } = await supabase
    .from("creative_scene_groups")
    .select("id, status, scene_count, montage_notes")
    .eq("id", sceneGroupId)
    .single();

  if (!group) return NextResponse.json({ error: "Scene group not found" }, { status: 404 });

  const { data: scenes } = await supabase
    .from("creative_generations")
    .select("scene_index, result_url, lipsynced_url, dialogue, word_timestamps, audio_duration")
    .eq("scene_group_id", sceneGroupId)
    .eq("status", "done")
    .not("result_url", "is", null)
    .order("scene_index", { ascending: true });

  if (!scenes || scenes.length === 0) {
    return NextResponse.json({ error: "Нет готовых сцен для монтажа" }, { status: 422 });
  }

  const typedScenes = scenes as Scene[];
  const videoElements = buildVideoElements(typedScenes);
  const subtitleElements = buildSubtitleElements(typedScenes);
  const hasSubtitles = subtitleElements.length > 0;

  const res = await fetch(`${CREATOMATE_API}/renders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CREATOMATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      output_format: "mp4",
      source: { width: 1080, height: 1920, elements: [...videoElements, ...subtitleElements] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Creatomate error ${res.status}: ${err.slice(0, 300)}` }, { status: 502 });
  }

  const renders = await res.json() as { id?: string; status?: string }[];
  const renderId = renders[0]?.id;
  if (!renderId) return NextResponse.json({ error: `No render ID: ${JSON.stringify(renders).slice(0, 200)}` }, { status: 502 });

  await supabase.from("creative_scene_groups").update({
    status: "stitching",
    creatomate_render_id: renderId,
    error_message: null,
  }).eq("id", sceneGroupId);

  return NextResponse.json({ ok: true, renderId, sceneCount: scenes.length, subtitlePhrases: subtitleElements.length, hasSubtitles });
}
