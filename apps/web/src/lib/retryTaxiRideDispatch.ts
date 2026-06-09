import type { SupabaseClient } from "@supabase/supabase-js";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";

export type TaxiOrphanRide = {
  id: string;
  status: string | null;
  dispatch_wave: number | null;
  updated_at: string | null;
  favorite_dispatch_expires_at?: string | null;
  preferred_driver_id?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function findTaxiRidesNeedingDispatchRetry(
  supabase: SupabaseClient,
  limit = 25
): Promise<TaxiOrphanRide[]> {
  const nowIso = new Date().toISOString();

  const { data: rides, error } = await supabase
    .from("taxi_rides")
    .select(
      "id, status, dispatch_wave, updated_at, payment_status, driver_id, favorite_dispatch_expires_at, preferred_driver_id"
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
    return [];
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

  return candidates
    .filter((ride) => !ridesWithActiveOffers.has(String(ride.id)))
    .slice(0, limit)
    .map((ride) => ({
      id: String(ride.id),
      status: ride.status as string | null,
      dispatch_wave: Number(ride.dispatch_wave ?? 0),
      updated_at: ride.updated_at as string | null,
      favorite_dispatch_expires_at: ride.favorite_dispatch_expires_at as string | null,
      preferred_driver_id: ride.preferred_driver_id as string | null,
    }));
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
