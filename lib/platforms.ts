// Реестр рекламных платформ (мультиплатформенный каркас).
// Meta Ads и Google Ads — рабочие интеграции. TikTok Ads — каркас: активируется,
// когда заданы TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID (см. /api/tiktok/sync).

export type AdPlatform = "meta" | "tiktok" | "google";

export interface PlatformInfo {
  id: AdPlatform;
  label: string;
  configured: boolean;   // заданы ли креды в env
}

export function getPlatforms(): PlatformInfo[] {
  return [
    { id: "meta", label: "Meta Ads", configured: !!process.env.META_ACCESS_TOKEN },
    {
      id: "google",
      label: "Google Ads",
      configured: !!(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN &&
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_CUSTOMER_ID
      ),
    },
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
