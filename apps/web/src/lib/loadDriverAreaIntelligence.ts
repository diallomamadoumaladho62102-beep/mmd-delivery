import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAreaIntelligence,
  type AreaIntelligenceResult,
  type OpenRequestPoint,
} from "@/lib/driverAreaIntelligence";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isOpenFoodOrder(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "").toLowerCase();
  const kind = String(row.kind ?? "").toLowerCase();
  const driverId = row.driver_id;
  if (driverId) return false;
  if (kind === "food" || kind === "restaurant") {
    return ["ready", "prepared", "paid_pending", "pending"].includes(status);
  }
  return false;
}

function isOpenDeliveryRequest(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "").toLowerCase();
  const driverId = row.driver_id;
  if (driverId) return false;
  return ["pending", "paid_pending", "processing_pending"].includes(status);
}

function isOpenTaxiRide(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "").toLowerCase();
  const driverId = row.driver_id;
  if (driverId) return false;
  return ["requested", "searching", "pending", "dispatching"].includes(status);
}

export async function loadDriverAreaIntelligence(
  supabase: SupabaseClient,
  params: {
    lat: number;
    lng: number;
    radiusMiles?: number;
    driverId: string;
    isOnline: boolean;
  }
): Promise<AreaIntelligenceResult> {
  const radiusMiles = Math.min(Math.max(params.radiusMiles ?? 5, 1), 15);
  const { lat, lng, driverId, isOnline } = params;

  const [driversRpc, ordersRes, deliveryRes, taxiRes] = await Promise.all([
    supabase.rpc("mmd_online_drivers_near", {
      p_lat: lat,
      p_lng: lng,
      p_radius_miles: radiusMiles,
      p_fresh_minutes: 12,
      p_exclude_driver_id: driverId,
    }),
    applyLiveTripFilters(
      supabase
        .from("orders")
        .select("id, kind, status, driver_id, pickup_lat, pickup_lng")
        .is("driver_id", null)
        .limit(400)
    ),
    applyLiveTripFilters(
      supabase
        .from("delivery_requests")
        .select("id, status, driver_id, pickup_lat, pickup_lng")
        .is("driver_id", null)
        .limit(400)
    ),
    applyLiveTripFilters(
      supabase
        .from("taxi_rides")
        .select("id, status, driver_id, pickup_lat, pickup_lng")
        .is("driver_id", null)
        .limit(400)
    ),
  ]);

  let driversNearby = Number(driversRpc.data ?? 0);
  if (driversRpc.error) {
    console.log("mmd_online_drivers_near error:", driversRpc.error.message);
    driversNearby = 0;
  }
  if (!Number.isFinite(driversNearby)) driversNearby = 0;
  const points: OpenRequestPoint[] = [];

  for (const row of (ordersRes.data ?? []) as Record<string, unknown>[]) {
    if (!isOpenFoodOrder(row)) continue;
    const plat = num(row.pickup_lat);
    const plng = num(row.pickup_lng);
    if (plat == null || plng == null) continue;
    points.push({
      id: String(row.id),
      kind: "food",
      lat: plat,
      lng: plng,
    });
  }

  for (const row of (deliveryRes.data ?? []) as Record<string, unknown>[]) {
    if (!isOpenDeliveryRequest(row)) continue;
    const plat = num(row.pickup_lat);
    const plng = num(row.pickup_lng);
    if (plat == null || plng == null) continue;
    points.push({
      id: String(row.id),
      kind: "delivery",
      lat: plat,
      lng: plng,
    });
  }

  for (const row of (taxiRes.data ?? []) as Record<string, unknown>[]) {
    if (!isOpenTaxiRide(row)) continue;
    const plat = num(row.pickup_lat);
    const plng = num(row.pickup_lng);
    if (plat == null || plng == null) continue;
    points.push({
      id: String(row.id),
      kind: "taxi",
      lat: plat,
      lng: plng,
    });
  }

  // Marketplace jobs (optional table / API surface)
  try {
    const { data: mpJobs } = await supabase
      .from("marketplace_delivery_jobs")
      .select("id, status, pickup_lat, pickup_lng, driver_id")
      .is("driver_id", null)
      .eq("status", "dispatch_ready")
      .limit(200);
    for (const row of (mpJobs ?? []) as Record<string, unknown>[]) {
      const plat = num(row.pickup_lat);
      const plng = num(row.pickup_lng);
      if (plat == null || plng == null) continue;
      points.push({
        id: String(row.id),
        kind: "marketplace",
        lat: plat,
        lng: plng,
      });
    }
  } catch {
    // Table may not exist in all environments
  }

  const hour = new Date().getHours();

  return computeAreaIntelligence({
    lat,
    lng,
    radiusMiles,
    driversNearby: Number.isFinite(driversNearby) ? driversNearby : 0,
    openRequests: points,
    hour,
    isOnline,
  });
}
