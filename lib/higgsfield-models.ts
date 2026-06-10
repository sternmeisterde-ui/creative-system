export type ModelCategory = "text-to-image" | "text-to-video";

export interface HiggsfieldModel {
  slug: string;           // API endpoint path (Higgsfield) или id модели (Gemini)
  label: string;          // UI display name
  category: ModelCategory;
  provider?: "higgsfield" | "gemini";  // по умолчанию higgsfield; gemini = image через Google API
  buildBody: (prompt: string) => Record<string, unknown>;
}

// ── Text-to-Image ─────────────────────────────────────────────────────────────

const t2iBase = (prompt: string) => ({
  prompt,
  num_images: 1,
  // soul принимает только 9:16/16:9/4:3/3:4/1:1/2:3/3:2 (4:5 → 422). 3:4 — ближайший портрет.
  aspect_ratio: "3:4",
  input_images: [],
  output_format: "png",
  safety_settings: [],
});

// ── Text-to-Video ─────────────────────────────────────────────────────────────

const klingBase = (prompt: string) => ({
  prompt,
  // Kling 2.6 Pro поддерживает 5 или 10 сек. Для многосценной склейки
  // (через /api/creative-gen/generate-scenes) 10с * 4-6 сцен = 40-60 сек итого.
  duration: 10,
  aspect_ratio: "9:16",
});

// ── Model registry ────────────────────────────────────────────────────────────

export const HIGGSFIELD_MODELS: HiggsfieldModel[] = [
  // Text-to-Image — Google Gemini (nano-banana) через наш GEMINI_API_KEY (НЕ Higgsfield).
  // Хорошо рендерит текст, в т.ч. кириллицу. buildBody для gemini не используется
  // (роут creative-gen/generate вызывает Gemini image API напрямую и грузит в Storage).
  {
    slug: "gemini-2.5-flash-image",
    label: "Nano Banana (Gemini 2.5 Flash Image)",
    category: "text-to-image",
    provider: "gemini",
    buildBody: (prompt) => ({ prompt }),
  },
  {
    slug: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image (preview)",
    category: "text-to-image",
    provider: "gemini",
    buildBody: (prompt) => ({ prompt }),
  },
  // Text-to-Image — Higgsfield (developer API). nano-banana* удалены (404), живы soul/*.
  {
    slug: "nano-banana-v2",
    label: "Nano Banana Pro 2",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "nano-banana",
    label: "Nano Banana",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "nano-banana-pro",
    label: "Nano Banana Pro",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "higgsfield-ai/soul/standard",
    label: "Soul Standard",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "higgsfield-ai/soul/character",
    label: "Soul Character",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "higgsfield-ai/soul/reference",
    label: "Soul Reference",
    category: "text-to-image",
    buildBody: t2iBase,
  },
  {
    slug: "popcorn-auto",
    label: "Popcorn Auto",
    category: "text-to-image",
    buildBody: t2iBase,
  },

  // Text-to-Video (automated pipeline via Higgsfield)
  // Note: Veo 3.1 is used manually via Google — not in automated pipeline
  {
    slug: "kling-video/v2.6/pro/text-to-video",
    label: "Kling 2.6 Pro",
    category: "text-to-video",
    buildBody: klingBase,
  },
  {
    slug: "kling-video/v3.0/standard/text-to-video",
    label: "Kling 3.0 Standard",
    category: "text-to-video",
    buildBody: klingBase,
  },
];

export const TEXT_TO_IMAGE_MODELS = HIGGSFIELD_MODELS.filter(m => m.category === "text-to-image");
export const TEXT_TO_VIDEO_MODELS = HIGGSFIELD_MODELS.filter(m => m.category === "text-to-video");

export function findModel(slug: string): HiggsfieldModel | undefined {
  return HIGGSFIELD_MODELS.find(m => m.slug === slug);
}

// Дефолт статики — Gemini nano-banana (хорошо рендерит русский текст), через GEMINI_API_KEY.
// Higgsfield-soul оставлен в реестре как fallback (плохо с текстом). nano-banana* у Higgsfield мертвы (404).
export const DEFAULT_STATIC_MODEL = "gemini-2.5-flash-image";
// Kling 2.6 Pro — лучшее качество видео в Higgsfield (платная, не в unlimited).
export const DEFAULT_VIDEO_MODEL  = "kling-video/v2.6/pro/text-to-video";
