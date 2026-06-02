import { DRIVER_NAV_PHASE_B } from "../phaseB.config";

export type BackgroundGpsSession = {
  driverId: string;
  orderId: string;
};

/**
 * Phase B — background GPS while navigation is minimized.
 * Not activated: call sites should no-op when disabled.
 */
export async function startBackgroundNavigationGps(
  _session: BackgroundGpsSession,
): Promise<void> {
  if (!DRIVER_NAV_PHASE_B.backgroundGps.enabled) return;
  // Future: expo-task-manager + startLocationUpdatesAsync
}

export async function stopBackgroundNavigationGps(): Promise<void> {
  if (!DRIVER_NAV_PHASE_B.backgroundGps.enabled) return;
}
