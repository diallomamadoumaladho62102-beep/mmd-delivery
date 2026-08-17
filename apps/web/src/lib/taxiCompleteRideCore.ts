import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceMeters } from "@/lib/driverZones";
import { executeTaxiDriverFareTransfer } from "@/lib/finance/executeTaxiDriverFareTransfer";
import { awardTaxiRideLoyalty } from "@/lib/loyalty/loyaltyAccrual";
import { notifyClientTaxiRideCompleted } from "@/lib/clientPushNotifications";
import { recordTaxiPreferenceStats } from "@/lib/taxiPreferenceDispatch";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { TAXI_DROPOFF_COMPLETE_MAX_METERS } from "@/lib/taxiProximityGate";

/** Statuses where a normal/driver complete (or admin force) is allowed. */
export const TAXI_COMPLETE_ALLOWED_STATUSES = ["in_progress"] as const;

export type TaxiCompleteRideRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  client_preferences?: unknown;
  ambiance_preference?: string | null;
  country_code?: string | null;
  vehicle_class?: string | null;
  assigned_fuel_type?: string | null;
  prefer_electric_or_hybrid?: boolean | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

export type TaxiCompletionSideEffectsResult = {
  driver_payout: Record<string, unknown> | null;
};

/**
 * Shared post-status side effects for driver GPS complete and admin force complete.
 * Must never throw for secondary work; payout remains fail-open.
 */
export async function runTaxiRideCompletionSideEffects(params: {
  supabaseAdmin: SupabaseClient;
  ride: TaxiCompleteRideRow;
  rideId: string;
  actorId: string;
  triggeredRole: "driver" | "admin";
  eventType: string;
  description: string;
  metadata?: Record<string, unknown>;
  distanceMeters?: number | null;
}): Promise<TaxiCompletionSideEffectsResult> {
  const { supabaseAdmin, ride, rideId } = params;

  await recordTaxiPreferenceStats(
    supabaseAdmin,
    ride as unknown as Record<string, unknown>,
  ).catch((err) => {
    console.log(
      "[taxi complete] preference stats error:",
      err instanceof Error ? err.message : err,
    );
  });

  await logTaxiEventServer(supabaseAdmin, {
    rideId,
    eventType: params.eventType,
    oldStatus: String(ride.status ?? ""),
    newStatus: "completed",
    actorId: params.actorId,
    triggeredRole: params.triggeredRole,
    description: params.description,
    metadata: {
      ...(params.metadata ?? {}),
      distance_meters: params.distanceMeters ?? null,
    },
  });

  await awardTaxiRideLoyalty(supabaseAdmin, rideId);

  try {
    await notifyClientTaxiRideCompleted({
      supabaseAdmin,
      userIds: [ride.client_user_id],
      taxiRideId: rideId,
    });
  } catch (e) {
    console.warn(
      "[taxi complete] client push fail-open",
      e instanceof Error ? e.message : e,
    );
  }

  let driverPayout: Record<string, unknown> | null = null;
  try {
    const payout = await executeTaxiDriverFareTransfer({
      supabaseAdmin,
      taxiRideId: rideId,
      dryRun: false,
      actor: `${params.triggeredRole}_complete:${params.actorId}`,
    });
    driverPayout = { ...payout };
    if (payout.ok === false) {
      console.warn("[taxi complete] immediate SCT deferred", {
        rideId,
        error: payout.error,
      });
    }
  } catch (e) {
    console.warn(
      "[taxi complete] immediate SCT fail-open",
      e instanceof Error ? e.message : e,
    );
    driverPayout = {
      ok: false,
      error: e instanceof Error ? e.message : "sct_exception",
    };
  }

  return { driver_payout: driverPayout };
}

export function computeDropoffDistanceMeters(input: {
  driverLat?: number | null;
  driverLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
}): number | null {
  if (
    input.driverLat == null ||
    input.driverLng == null ||
    input.dropoffLat == null ||
    input.dropoffLng == null
  ) {
    return null;
  }
  if (
    !Number.isFinite(input.driverLat) ||
    !Number.isFinite(input.driverLng) ||
    !Number.isFinite(input.dropoffLat) ||
    !Number.isFinite(input.dropoffLng)
  ) {
    return null;
  }
  return distanceMeters(
    Number(input.driverLat),
    Number(input.driverLng),
    Number(input.dropoffLat),
    Number(input.dropoffLng),
  );
}

export type AdminForceCompleteResult =
  | {
      ok: true;
      taxi_ride_id: string;
      previous_status: string;
      status: "completed";
      distance_meters: number | null;
      bypassed_proximity: true;
      proximity_max_meters: number;
      driver_payout: Record<string, unknown> | null;
      driver_gps: { lat: number; lng: number } | null;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

/**
 * Admin-only completion that skips GPS proximity. Does NOT use
 * driver_complete_taxi_ride (that RPC requires driver JWT + GPS ≤ 150m).
 */
export async function adminForceCompleteTaxiRide(params: {
  supabaseAdmin: SupabaseClient;
  rideId: string;
  adminUserId: string;
  reason?: string | null;
  driverLat?: number | null;
  driverLng?: number | null;
}): Promise<AdminForceCompleteResult> {
  const rideId = String(params.rideId ?? "").trim();
  if (!rideId) {
    return { ok: false, error: "Missing rideId", status: 400 };
  }

  const { data: ride, error: readError } = await params.supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,status,payment_status,client_user_id,driver_id,client_preferences,ambiance_preference,country_code,vehicle_class,assigned_fuel_type,prefer_electric_or_hybrid,dropoff_lat,dropoff_lng",
    )
    .eq("id", rideId)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: readError.message, status: 500 };
  }
  if (!ride) {
    return { ok: false, error: "ride_not_found", status: 404 };
  }

  const previousStatus = String(ride.status ?? "").trim().toLowerCase();
  if (previousStatus === "completed") {
    return { ok: false, error: "ride_already_completed", status: 409 };
  }
  if (
    !(TAXI_COMPLETE_ALLOWED_STATUSES as readonly string[]).includes(
      previousStatus,
    )
  ) {
    return { ok: false, error: "invalid_status", status: 409 };
  }

  let driverLat = params.driverLat;
  let driverLng = params.driverLng;
  if (
    (driverLat == null || driverLng == null) &&
    ride.driver_id
  ) {
    const { data: loc } = await params.supabaseAdmin
      .from("driver_locations")
      .select("lat,lng")
      .eq("driver_id", ride.driver_id)
      .maybeSingle();
    if (loc) {
      driverLat = Number(loc.lat);
      driverLng = Number(loc.lng);
    }
  }

  const distance = computeDropoffDistanceMeters({
    driverLat,
    driverLng,
    dropoffLat: ride.dropoff_lat as number | null,
    dropoffLng: ride.dropoff_lng as number | null,
  });

  const completedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await params.supabaseAdmin
    .from("taxi_rides")
    .update({
      status: "completed",
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", rideId)
    .eq("status", ride.status)
    .select("id,status")
    .maybeSingle();

  if (updateError) {
    return { ok: false, error: updateError.message, status: 500 };
  }
  if (!updated) {
    return { ok: false, error: "ride_already_completed", status: 409 };
  }

  const { error: commissionsError } = await params.supabaseAdmin.rpc(
    "refresh_taxi_commissions",
    { p_ride_id: rideId },
  );
  if (commissionsError) {
    console.warn(
      "[admin force complete] refresh_taxi_commissions",
      commissionsError.message,
    );
  }

  const reason =
    String(params.reason ?? "").trim() || "admin_force_complete";

  const sideEffects = await runTaxiRideCompletionSideEffects({
    supabaseAdmin: params.supabaseAdmin,
    ride: ride as TaxiCompleteRideRow,
    rideId,
    actorId: params.adminUserId,
    triggeredRole: "admin",
    eventType: "admin_force_complete",
    description: "Admin force-completed taxi ride (GPS proximity bypassed)",
    metadata: {
      reason,
      action: "admin_force_complete",
      bypassed_proximity: true,
      previous_status: previousStatus,
      distance_meters: distance,
      driver_lat: driverLat ?? null,
      driver_lng: driverLng ?? null,
      proximity_max_meters: TAXI_DROPOFF_COMPLETE_MAX_METERS,
    },
    distanceMeters: distance,
  });

  return {
    ok: true,
    taxi_ride_id: rideId,
    previous_status: previousStatus,
    status: "completed",
    distance_meters: distance,
    bypassed_proximity: true,
    proximity_max_meters: TAXI_DROPOFF_COMPLETE_MAX_METERS,
    driver_payout: sideEffects.driver_payout,
    driver_gps:
      driverLat != null &&
      driverLng != null &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng)
        ? { lat: Number(driverLat), lng: Number(driverLng) }
        : null,
  };
}
