/**
 * Subscription tier constants controlling video generation limits.
 */
export const TIER_CAPS = {
  free: {
    videoDurationSeconds: 60,
    label: "Free",
  },
  pro: {
    videoDurationSeconds: 300,
    label: "Pro",
  },
  vendor: {
    videoDurationSeconds: 180,
    label: "Vendor",
  },
} as const;

export type SubscriptionTier = keyof typeof TIER_CAPS;

export function getDurationCap(tier: SubscriptionTier): number {
  return TIER_CAPS[tier]?.videoDurationSeconds ?? 60;
}
