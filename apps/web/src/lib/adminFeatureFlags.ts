/**
 * Control Center enterprise feature flags — fail-closed.
 * Incomplete capabilities must stay disabled until wired end-to-end.
 */
export const CC_FEATURE_FLAGS = {
  liveMapboxOpsMap: false,
  staffRealtimeComms: false,
  staffAudioVideoCalls: false,
  staffGeoScopesUi: false,
  staffPerformanceMetrics: false,
  staffPresenceRealtime: false,
  headerNotificationsFeed: false,
} as const;

export type CcFeatureFlag = keyof typeof CC_FEATURE_FLAGS;

export function isCcFeatureEnabled(flag: CcFeatureFlag): boolean {
  return Boolean(CC_FEATURE_FLAGS[flag]);
}
