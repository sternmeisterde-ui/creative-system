// Реестр рекламных платформ (мультиплатформенный каркас).
// Meta Ads — рабочая интеграция. TikTok Ads — каркас: активируется, когда заданы
// TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID (см. /api/tiktok/sync).

export type AdPlatform = "meta" | "tiktok";

export interface PlatformInfo {
  id: AdPlatform;
  label: string;
  configured: boolean;   // заданы ли креды в env
}

export function getPlatforms(): PlatformInfo[] {
  return [
    { id: "meta", label: "Meta Ads", configured: !!process.env.META_ACCESS_TOKEN },
    {
      id: "tiktok",
      label: "TikTok Ads",
      configured: !!(process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID),
    },
  ];
}

export function isPlatformConfigured(id: AdPlatform): boolean {
  return getPlatforms().find(p => p.id === id)?.configured ?? false;
}
