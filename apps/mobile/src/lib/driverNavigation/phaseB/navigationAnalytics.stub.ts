import { DRIVER_NAV_PHASE_B } from "../phaseB.config";
import type { NavigationStage } from "../types";

export type NavigationAnalyticsEvent =
  | { type: "session_start"; orderId: string; stage: NavigationStage }
  | { type: "session_end"; orderId: string; durationMs: number }
  | { type: "reroute"; orderId: string; reason: "deviation" | "manual" }
  | { type: "gps_lost"; orderId: string; durationMs: number }
  | { type: "network_weak"; orderId: string };

const pendingEvents: NavigationAnalyticsEvent[] = [];

export function trackNavigationEvent(event: NavigationAnalyticsEvent): void {
  if (!DRIVER_NAV_PHASE_B.navigationAnalytics.enabled) return;
  pendingEvents.push(event);
}

export function flushNavigationAnalytics(): NavigationAnalyticsEvent[] {
  if (!DRIVER_NAV_PHASE_B.navigationAnalytics.enabled) return [];
  const batch = [...pendingEvents];
  pendingEvents.length = 0;
  return batch;
}
