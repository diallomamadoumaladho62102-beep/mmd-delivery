/**
 * Phase B capabilities — architecture prepared, not activated in production.
 * Flip individual flags only after product validation and QA.
 */
export const DRIVER_NAV_PHASE_B = {
  backgroundGps: {
    enabled: false,
    taskName: "MMD_DRIVER_BACKGROUND_NAVIGATION",
  },
  navigationAnalytics: {
    enabled: false,
    batchFlushMs: 30_000,
  },
  zoneHeatmaps: {
    enabled: false,
    refreshIntervalMs: 120_000,
  },
} as const;

export type DriverNavPhaseBFeature = keyof typeof DRIVER_NAV_PHASE_B;

export function isPhaseBFeatureEnabled(feature: DriverNavPhaseBFeature): boolean {
  return DRIVER_NAV_PHASE_B[feature].enabled;
}
