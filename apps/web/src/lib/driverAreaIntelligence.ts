/**
 * Live driver-area intelligence (Uber/Lyft-style supply & demand).
 * All metrics are computed from production rows — no mock values.
 */

export type DemandLevel = "calm" | "moderate" | "busy" | "very_busy";

export type DemandHotspot = {
  id: string;
  lat: number;
  lng: number;
  request_count: number;
  score: number;
  multiplier: number;
  demand_level: DemandLevel;
  label: string;
};

export type OpenRequestPoint = {
  id: string;
  kind: "food" | "delivery" | "taxi" | "marketplace";
  lat: number;
  lng: number;
};

export type AreaIntelligenceInput = {
  lat: number;
  lng: number;
  radiusMiles: number;
  driversNearby: number;
  openRequests: OpenRequestPoint[];
  /** Local hour 0-23 for rush adjustments */
  hour: number;
  isOnline: boolean;
};

export type AreaIntelligenceResult = {
  area: { lat: number; lng: number; radius_miles: number };
  drivers_nearby: number;
  requests_nearby: number;
  demand_level: DemandLevel;
  demand_label: string;
  earnings_multiplier: number;
  wait_minutes_min: number | null;
  wait_minutes_max: number | null;
  wait_label: string;
  nearest_request_miles: number | null;
  hotspots: DemandHotspot[];
  best_hotspot: DemandHotspot | null;
  smart_dispatch: {
    status: "live" | "offline" | "quiet";
    recommendation: string;
    chips: string[];
  };
};

const EARTH_MI = 3958.8;

export function milesBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Cell size ~0.8 mi at mid-latitudes for hotspot clustering. */
const CELL_DEG = 0.012;

export function demandLevelFromRatio(
  requests: number,
  drivers: number
): DemandLevel {
  if (requests <= 0) return "calm";
  const ratio = requests / Math.max(drivers, 1);
  if (ratio >= 2.5 || (drivers === 0 && requests >= 3)) return "very_busy";
  if (ratio >= 1.4 || requests >= 5) return "busy";
  if (ratio >= 0.7 || requests >= 2) return "moderate";
  return "calm";
}

export function demandLabel(level: DemandLevel): string {
  if (level === "very_busy") return "High demand";
  if (level === "busy") return "Busy";
  if (level === "moderate") return "Moderate";
  return "Quiet";
}

/**
 * Earnings multiplier from live supply/demand.
 * 1.0 baseline → up to 2.0 when requests heavily outpace online drivers.
 */
export function earningsMultiplierFromSupplyDemand(
  requests: number,
  drivers: number
): number {
  if (requests <= 0) return 1.0;
  const ratio = requests / Math.max(drivers, 0.5);
  // Map ratio 0.5→1.0, 1→1.15, 2→1.4, 3→1.7, 4+→2.0
  const raw = 1 + Math.log2(1 + ratio) * 0.55;
  return Math.round(clamp(raw, 1.0, 2.0) * 100) / 100;
}

export function estimateWaitFromSupplyDemand(params: {
  isOnline: boolean;
  requests: number;
  drivers: number;
  nearestMiles: number | null;
  hour: number;
}): { min: number; max: number } | null {
  const { isOnline, requests, drivers, nearestMiles, hour } = params;
  if (!isOnline) return null;

  const level = demandLevelFromRatio(requests, drivers);
  let min = level === "very_busy" ? 2 : level === "busy" ? 3 : level === "moderate" ? 5 : 9;
  let max = level === "very_busy" ? 5 : level === "busy" ? 8 : level === "moderate" ? 12 : 20;

  // More open requests → shorter expected wait for the next offer.
  if (requests >= 8) {
    min -= 2;
    max -= 4;
  } else if (requests >= 4) {
    min -= 1;
    max -= 2;
  } else if (requests === 0) {
    min += 3;
    max += 6;
  }

  // More drivers competing → slightly longer personal wait.
  if (drivers >= 12) {
    min += 2;
    max += 3;
  } else if (drivers >= 6) {
    min += 1;
    max += 2;
  }

  if (nearestMiles != null) {
    if (nearestMiles <= 1) {
      min -= 1;
      max -= 2;
    } else if (nearestMiles >= 4) {
      min += 1;
      max += 2;
    }
  }

  const rush = (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21);
  const late = hour >= 23 || hour <= 5;
  if (rush) {
    min -= 1;
    max -= 2;
  } else if (late) {
    min += 2;
    max += 3;
  }

  min = Math.round(clamp(min, 1, 30));
  max = Math.round(clamp(max, min + 1, 40));
  return { min, max };
}

export function clusterHotspots(
  points: OpenRequestPoint[],
  origin: { lat: number; lng: number },
  driversNearby: number
): DemandHotspot[] {
  if (points.length === 0) return [];

  const cells = new Map<
    string,
    { latSum: number; lngSum: number; count: number; kinds: Set<string> }
  >();

  for (const p of points) {
    const key = `${Math.floor(p.lat / CELL_DEG)}_${Math.floor(p.lng / CELL_DEG)}`;
    const cur = cells.get(key) ?? {
      latSum: 0,
      lngSum: 0,
      count: 0,
      kinds: new Set<string>(),
    };
    cur.latSum += p.lat;
    cur.lngSum += p.lng;
    cur.count += 1;
    cur.kinds.add(p.kind);
    cells.set(key, cur);
  }

  const hotspots: DemandHotspot[] = [];
  for (const [key, cell] of cells) {
    const lat = cell.latSum / cell.count;
    const lng = cell.lngSum / cell.count;
    const distanceBoost = 1 / (1 + milesBetween(origin.lat, origin.lng, lat, lng) / 3);
    const score = cell.count * 10 * distanceBoost;
    const multiplier = earningsMultiplierFromSupplyDemand(cell.count, driversNearby);
    const level = demandLevelFromRatio(cell.count, Math.max(1, Math.round(driversNearby / 3)));
    const kindHint = [...cell.kinds].slice(0, 2).join(" · ");
    hotspots.push({
      id: `hs_${key}`,
      lat,
      lng,
      request_count: cell.count,
      score: Math.round(score * 10) / 10,
      multiplier,
      demand_level: level,
      label:
        cell.count === 1
          ? `1 open request${kindHint ? ` (${kindHint})` : ""}`
          : `${cell.count} open requests${kindHint ? ` (${kindHint})` : ""}`,
    });
  }

  return hotspots.sort((a, b) => b.score - a.score).slice(0, 12);
}

export function buildSmartDispatchCopy(params: {
  isOnline: boolean;
  requests: number;
  drivers: number;
  multiplier: number;
  best: DemandHotspot | null;
  nearestMiles: number | null;
}): AreaIntelligenceResult["smart_dispatch"] {
  const { isOnline, requests, drivers, multiplier, best, nearestMiles } = params;
  if (!isOnline) {
    return {
      status: "offline",
      recommendation: "Go online to receive optimized nearby offers.",
      chips: [],
    };
  }

  const chips: string[] = ["Nearby", "Optimized"];
  if (multiplier > 1.05) {
    chips.push(`${multiplier.toFixed(1)}x earnings`);
  }
  if (requests > 0) {
    chips.push(`${requests} open`);
  }

  if (requests === 0) {
    return {
      status: "quiet",
      recommendation:
        drivers > 0
          ? `${drivers} driver(s) online nearby — stay ready for the next request.`
          : "No open requests in range yet. Stay online for the next dispatch wave.",
      chips,
    };
  }

  const nearest =
    nearestMiles != null ? ` Nearest pickup ${nearestMiles.toFixed(1)} mi.` : "";
  const hotspotHint = best
    ? ` Best cluster: ${best.request_count} request(s) at ${best.multiplier.toFixed(1)}x.`
    : "";

  return {
    status: "live",
    recommendation: `Analyzing ${requests} open request(s) vs ${drivers} online driver(s).${nearest}${hotspotHint}`,
    chips,
  };
}

export function computeAreaIntelligence(
  input: AreaIntelligenceInput
): AreaIntelligenceResult {
  const inRadius = input.openRequests.filter(
    (p) =>
      milesBetween(input.lat, input.lng, p.lat, p.lng) <= input.radiusMiles
  );

  let nearest: number | null = null;
  for (const p of inRadius) {
    const m = milesBetween(input.lat, input.lng, p.lat, p.lng);
    nearest = nearest == null ? m : Math.min(nearest, m);
  }

  const requests = inRadius.length;
  const drivers = Math.max(0, Math.floor(input.driversNearby));
  const level = demandLevelFromRatio(requests, drivers);
  const multiplier = earningsMultiplierFromSupplyDemand(requests, drivers);
  const wait = estimateWaitFromSupplyDemand({
    isOnline: input.isOnline,
    requests,
    drivers,
    nearestMiles: nearest,
    hour: input.hour,
  });
  const hotspots = clusterHotspots(inRadius, { lat: input.lat, lng: input.lng }, drivers);
  const best = hotspots[0] ?? null;
  const smart = buildSmartDispatchCopy({
    isOnline: input.isOnline,
    requests,
    drivers,
    multiplier,
    best,
    nearestMiles: nearest,
  });

  return {
    area: {
      lat: input.lat,
      lng: input.lng,
      radius_miles: input.radiusMiles,
    },
    drivers_nearby: drivers,
    requests_nearby: requests,
    demand_level: level,
    demand_label: demandLabel(level),
    earnings_multiplier: multiplier,
    wait_minutes_min: wait?.min ?? null,
    wait_minutes_max: wait?.max ?? null,
    wait_label: wait ? `${wait.min}–${wait.max} min` : "—",
    nearest_request_miles:
      nearest != null ? Math.round(nearest * 10) / 10 : null,
    hotspots,
    best_hotspot: best,
    smart_dispatch: smart,
  };
}
