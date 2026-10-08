import type { OpsTimelineStep } from "@/lib/adminOpsMap";
import {
  STALE_ASSIGNED_JOB_AGE_MS,
  isAbandonedStaleAssignedJob,
} from "@/lib/adminStaleDriverJobs";

/** Same freshness window the ops-map API already uses for driver GPS. */
export const OPS_LOCATION_STALE_MS = 15 * 60 * 1000;

export type OpsService = "taxi" | "food" | "delivery" | "marketplace";
export type OpsPhase =
  | "waiting"
  | "pickup"
  | "picked_up"
  | "en_route"
  | "arriving"
  | "active";

export type OpsAttentionReason = "location_stale" | "delayed" | "safety";

export type OpsMission = {
  id: string;
  service: OpsService;
  status: string;
  phase: OpsPhase;
  href: string;
  driverId: string | null;
  clientId: string | null;
  partnerLabel: string | null;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  etaMinutes: number | null;
  locationUpdatedAt: string | null;
  locationStale: boolean;
  delayed: boolean;
  attention: OpsAttentionReason | null;
  lat: number | null;
  lng: number | null;
  timeline: OpsTimelineStep[];
  updatedAt: string | null;
};

export type OpsActivity = {
  id: string;
  at: string;
  service: OpsService | "safety";
  label: string;
  missionId: string | null;
};

export type OpsAttentionItem = {
  id: string;
  missionId: string | null;
  service: OpsService | "safety";
  reason: OpsAttentionReason;
  label: string;
  lat: number | null;
  lng: number | null;
};

export type OpsLiveMetrics = {
  taxi: number;
  food: number;
  delivery: number;
  marketplace: number;
  total: number;
  onTime: number;
  delayed: number;
  waiting: number;
  attention: number;
};

export type OpsSafetyReport = {
  id: string;
  label: string;
  status: string;
  at: string | null;
  lat: number | null;
  lng: number | null;
};

const TERMINAL = new Set([
  "delivered",
  "completed",
  "canceled",
  "cancelled",
  "expired",
  "rejected",
  "refunded",
  "failed",
  "closed",
  "done",
]);

const WAITING = new Set([
  "pending",
  "paid",
  "paid_pending",
  "processing_pending",
  "dispatching",
]);
const PICKUP = new Set([
  "accepted",
  "preparing",
  "ready",
  "driver_assigned",
  "prepared",
  "assigned",
]);
const ARRIVING = new Set(["driver_arrived", "arrived"]);
const PICKED = new Set(["picked_up", "pickup"]);
const EN_ROUTE = new Set([
  "en_route",
  "out_for_delivery",
  "in_progress",
  "in_transit",
  "dispatched",
  "on_the_way",
]);

export function opsServiceFromKind(kind: string | null | undefined): OpsService | null {
  const value = String(kind ?? "").trim().toLowerCase();
  if (value === "food") return "food";
  if (value === "marketplace") return "marketplace";
  if (value === "delivery" || value === "package") return "delivery";
  if (value === "taxi") return "taxi";
  return null;
}

export function isLiveOpsStatus(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return value.length > 0 && !TERMINAL.has(value);
}

export function opsPhaseFromStatus(status: string | null | undefined): OpsPhase {
  const value = String(status ?? "").trim().toLowerCase();
  if (WAITING.has(value)) return "waiting";
  if (ARRIVING.has(value)) return "arriving";
  if (PICKED.has(value)) return "picked_up";
  if (EN_ROUTE.has(value)) return "en_route";
  if (PICKUP.has(value)) return "pickup";
  return "active";
}

export function isDriverLocationStale(
  updatedAt: string | null | undefined,
  nowMs: number,
  staleMs: number = OPS_LOCATION_STALE_MS,
): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= staleMs;
}

/** Road ETA only. Straight-line fallback minutes are not shown. */
export function trustedRouteEtaMinutes(
  source: string | null | undefined,
  minutes: number | null | undefined,
): number | null {
  if (source !== "mapbox" && source !== "cache") return null;
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return Math.round(minutes);
}

export function missionMatchesQuery(mission: OpsMission, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    mission.id,
    mission.service,
    mission.status,
    mission.phase,
    mission.driverId,
    mission.clientId,
    mission.partnerLabel,
    mission.pickupLabel,
    mission.dropoffLabel,
    mission.href,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterOpsMissions(
  missions: OpsMission[],
  filters: { service?: OpsService | "all"; phase?: OpsPhase | "all" | "attention" | "delayed"; q?: string },
): OpsMission[] {
  return missions.filter((mission) => {
    if (filters.service && filters.service !== "all" && mission.service !== filters.service) {
      return false;
    }
    if (filters.phase === "attention" && !mission.attention) return false;
    if (filters.phase === "delayed" && !mission.delayed) return false;
    if (
      filters.phase &&
      filters.phase !== "all" &&
      filters.phase !== "attention" &&
      filters.phase !== "delayed" &&
      mission.phase !== filters.phase
    ) {
      return false;
    }
    return missionMatchesQuery(mission, filters.q ?? "");
  });
}

function attentionFor(mission: Pick<OpsMission, "locationStale" | "delayed">): OpsAttentionReason | null {
  if (mission.locationStale) return "location_stale";
  if (mission.delayed) return "delayed";
  return null;
}

export function decorateOpsMission(
  draft: Omit<OpsMission, "phase" | "locationStale" | "delayed" | "attention" | "etaMinutes"> & {
    etaMinutes?: number | null;
    etaSource?: string | null;
    driverAssigned: boolean;
    nowMs: number;
  },
): OpsMission {
  const phase = opsPhaseFromStatus(draft.status);
  const locationStale = draft.driverAssigned
    ? isDriverLocationStale(draft.locationUpdatedAt, draft.nowMs)
    : false;
  const delayed = isAbandonedStaleAssignedJob(
    {
      status: draft.status,
      updated_at: draft.updatedAt,
      created_at: draft.updatedAt,
    },
    draft.nowMs,
    STALE_ASSIGNED_JOB_AGE_MS,
  );
  const etaMinutes = trustedRouteEtaMinutes(draft.etaSource, draft.etaMinutes);
  const mission: OpsMission = {
    id: draft.id,
    service: draft.service,
    status: draft.status,
    phase,
    href: draft.href,
    driverId: draft.driverId,
    clientId: draft.clientId,
    partnerLabel: draft.partnerLabel,
    pickupLabel: draft.pickupLabel,
    dropoffLabel: draft.dropoffLabel,
    etaMinutes,
    locationUpdatedAt: draft.locationUpdatedAt,
    locationStale,
    delayed,
    attention: null,
    lat: draft.lat,
    lng: draft.lng,
    timeline: draft.timeline,
    updatedAt: draft.updatedAt,
  };
  mission.attention = attentionFor(mission);
  return mission;
}

export function buildOpsLiveCenter(args: {
  missions: OpsMission[];
  safety?: OpsSafetyReport[];
  nowMs?: number;
}): {
  metrics: OpsLiveMetrics;
  missions: OpsMission[];
  activity: OpsActivity[];
  attention: OpsAttentionItem[];
  safety: OpsSafetyReport[];
} {
  const missions = args.missions.filter((mission) => isLiveOpsStatus(mission.status));
  const safety = (args.safety ?? []).filter((report) => {
    const status = report.status.trim().toLowerCase();
    return status.length > 0 && !TERMINAL.has(status) && status !== "resolved";
  });

  const metrics: OpsLiveMetrics = {
    taxi: 0,
    food: 0,
    delivery: 0,
    marketplace: 0,
    total: missions.length,
    onTime: 0,
    delayed: 0,
    waiting: 0,
    attention: 0,
  };

  for (const mission of missions) {
    metrics[mission.service] += 1;
    if (mission.phase === "waiting") metrics.waiting += 1;
    if (mission.delayed) metrics.delayed += 1;
    if (mission.attention || mission.delayed || mission.locationStale) metrics.attention += 1;
    if (!mission.delayed && !mission.locationStale) metrics.onTime += 1;
  }
  metrics.attention += safety.length;

  const activity: OpsActivity[] = [];
  for (const mission of missions) {
    for (const step of mission.timeline) {
      if (!step.at) continue;
      activity.push({
        id: `${mission.id}:${step.key}:${step.at}`,
        at: step.at,
        service: mission.service,
        label: step.label,
        missionId: mission.id,
      });
    }
  }
  for (const report of safety) {
    if (!report.at) continue;
    activity.push({
      id: `safety:${report.id}`,
      at: report.at,
      service: "safety",
      label: report.label,
      missionId: null,
    });
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const attention: OpsAttentionItem[] = [];
  for (const mission of missions) {
    if (!mission.attention && !mission.delayed && !mission.locationStale) continue;
    attention.push({
      id: `attention:${mission.id}`,
      missionId: mission.id,
      service: mission.service,
      reason: mission.attention ?? (mission.locationStale ? "location_stale" : "delayed"),
      label: mission.partnerLabel || mission.pickupLabel || mission.id,
      lat: mission.lat,
      lng: mission.lng,
    });
  }
  for (const report of safety) {
    attention.push({
      id: `attention:safety:${report.id}`,
      missionId: null,
      service: "safety",
      reason: "safety",
      label: report.label,
      lat: report.lat,
      lng: report.lng,
    });
  }

  return {
    metrics,
    missions,
    activity: activity.slice(0, 40),
    attention: attention.slice(0, 40),
    safety,
  };
}
