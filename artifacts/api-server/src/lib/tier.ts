/**
 * Subscription tier constants controlling video generation limits.
 */
export const TIER_CAPS = {
  free: {
    videoDurationSeconds: 60,
    videoQuality: "720p" as const,
    maxResolutionPx: 1280,
    label: "Free",
  },
  pro: {
    videoDurationSeconds: 300,
    videoQuality: "1080p" as const,
    maxResolutionPx: 1920,
    label: "Pro",
  },
  vendor: {
    videoDurationSeconds: 180,
    videoQuality: "720p" as const,
    maxResolutionPx: 1280,
    label: "Vendor",
  },
} as const;

export type SubscriptionTier = keyof typeof TIER_CAPS;
export type VideoQuality = (typeof TIER_CAPS)[SubscriptionTier]["videoQuality"];

export function getDurationCap(tier: SubscriptionTier): number {
  return TIER_CAPS[tier]?.videoDurationSeconds ?? 60;
}

export function getQualityCap(tier: SubscriptionTier): {
  quality: VideoQuality;
  maxResolutionPx: number;
} {
  const caps = TIER_CAPS[tier] ?? TIER_CAPS.free;
  return { quality: caps.videoQuality, maxResolutionPx: caps.maxResolutionPx };
}
