import type { SupabaseClient } from "@supabase/supabase-js";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";
import { resolveTaxiDispatchRetryDecision } from "@/lib/taxiSharedRideDispatch";

export type TaxiOrphanRide = {
  id: string;
  status: string | null;
  dispatch_wave: number | null;
  updated_at: string | null;
  favorite_dispatch_expires_at?: string | null;
  preferred_driver_id?: string | null;
};

export type TaxiDispatchRetryScanResult = {
  rides: TaxiOrphanRide[];
  skipped: { id: string; reason: string }[];
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function findTaxiRidesNeedingDispatchRetry(
  supabase: SupabaseClient,
  limit = 25
): Promise<TaxiDispatchRetryScanResult> {
  const nowIso = new Date().toISOString();

  const { data: rides, error } = await supabase
    .from("taxi_rides")
    .select(
      "id, status, dispatch_wave, updated_at, payment_status, driver_id, favorite_dispatch_expires_at, preferred_driver_id, is_shared_ride, shared_ride_id, is_scheduled"
    )
    .is("driver_id", null)
    .eq("payment_status", "paid")
    .in("status", ["paid", "dispatching"])
    .order("updated_at", { ascending: true })
    .limit(Math.max(limit * 3, 50));

  if (error) {
    throw new Error(error.message);
  }

  const candidates = (rides ?? []).filter((ride) => {
    const status = normalize(ride.status);
    return status === "paid" || status === "dispatching";
  });

  if (candidates.length === 0) {
    return { rides: [], skipped: [] };
  }

  const rideIds = candidates.map((r) => String(r.id));

  const { data: activeOffers, error: offersError } = await supabase
    .from("taxi_offers")
    .select("taxi_ride_id")
    .in("taxi_ride_id", rideIds)
    .eq("status", "pending")
    .gt("expires_at", nowIso);

  if (offersError) {
    throw new Error(offersError.message);
  }

  const ridesWithActiveOffers = new Set(
    (activeOffers ?? []).map((o) => String(o.taxi_ride_id))
  );

  const withoutOffers = candidates.filter(
    (ride) => !ridesWithActiveOffers.has(String(ride.id))
  );

  const eligible: TaxiOrphanRide[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const seenDispatchIds = new Set<string>();

  for (const ride of withoutOffers) {
    const rideId = String(ride.id);
    const decision = await resolveTaxiDispatchRetryDecision({
      supabase,
      taxiRideId: rideId,
    });

    if (!decision.shouldRetry) {
      const reason = decision.skipReason ?? "dispatch_retry_not_eligible";
      skipped.push({ id: rideId, reason });

      await logTaxiEventServer(supabase, {
        rideId: rideId,
        eventType: "dispatch_retry_skipped",
        oldStatus: ride.status as string | null,
        newStatus: ride.status as string | null,
        triggeredRole: "system",
        description: "Taxi dispatch retry skipped for ride",
        metadata: {
          source: "cron:retry-taxi-dispatch",
          skip_reason: reason,
          dispatch_ride_id: decision.dispatchRideId,
        },
      });
      continue;
    }

    if (seenDispatchIds.has(decision.dispatchRideId)) {
      continue;
    }
    seenDispatchIds.add(decision.dispatchRideId);

    const sourceRide =
      decision.dispatchRideId === rideId
        ? ride
        : candidates.find((row) => String(row.id) === decision.dispatchRideId) ?? ride;

    eligible.push({
      id: decision.dispatchRideId,
      status: sourceRide.status as string | null,
      dispatch_wave: Number(sourceRide.dispatch_wave ?? 0),
      updated_at: sourceRide.updated_at as string | null,
      favorite_dispatch_expires_at: sourceRide.favorite_dispatch_expires_at as
        | string
        | null,
      preferred_driver_id: sourceRide.preferred_driver_id as string | null,
    });

    if (eligible.length >= limit) {
      break;
    }
  }

  return { rides: eligible, skipped };
}

export function resolveRetryDispatchWave(ride: TaxiOrphanRide): number {
  const status = normalize(ride.status);
  const currentWave = Math.max(Number(ride.dispatch_wave ?? 0), 0);
  const nowMs = Date.now();
  const favoriteExpiresMs = ride.favorite_dispatch_expires_at
    ? Date.parse(ride.favorite_dispatch_expires_at)
    : NaN;

  if (
    currentWave === 0 &&
    status === "dispatching" &&
    Number.isFinite(favoriteExpiresMs) &&
    favoriteExpiresMs <= nowMs
  ) {
    return 1;
  }

  if (status === "paid" && currentWave === 0) {
    const preferred = String(ride.preferred_driver_id ?? "").trim();
    if (preferred && !ride.favorite_dispatch_expires_at) {
      return 0;
    }
    return 1;
  }

  if (status === "paid") {
    return 1;
  }

  return Math.min(currentWave + 1, 3);
}

export async function findTaxiRidesNeedingFavoriteFallback(
  supabase: SupabaseClient,
  limit = 25
): Promise<TaxiOrphanRide[]> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("taxi_rides")
    .select("id, status, dispatch_wave, updated_at, favorite_dispatch_expires_at")
    .eq("status", "dispatching")
    .eq("dispatch_wave", 0)
    .is("driver_id", null)
    .lte("favorite_dispatch_expires_at", nowIso)
    .order("favorite_dispatch_expires_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((ride) => ({
    id: String(ride.id),
    status: ride.status as string | null,
    dispatch_wave: Number(ride.dispatch_wave ?? 0),
    updated_at: ride.updated_at as string | null,
    favorite_dispatch_expires_at: ride.favorite_dispatch_expires_at as string | null,
  }));
}

export async function retryTaxiRideDispatch(params: {
  supabase: SupabaseClient;
  taxiRideId: string;
  wave?: number;
  actorId?: string | null;
  source?: string;
}) {
  const { supabase, taxiRideId } = params;
  const wave = Math.min(Math.max(Number(params.wave ?? 1), 0), 3);

  const result = await runTaxiRideDispatch({
    supabase,
    taxiRideId,
    wave,
  });

  await logTaxiEventServer(supabase, {
    rideId: taxiRideId,
    eventType: "taxi_dispatch_retry",
    oldStatus: null,
    newStatus: null,
    actorId: params.actorId ?? null,
    triggeredRole: params.actorId ? "admin" : "system",
    description: "Taxi dispatch retry triggered",
    metadata: {
      source: params.source ?? "retry",
      wave,
      result,
    },
  });

  return result;
}
