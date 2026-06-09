import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerTaxiRideDispatch } from "@/lib/scheduleTaxiRideDispatch";
import { resolveInitialTaxiDispatchWave } from "@/lib/taxiPremiumDispatch";

export const TAXI_SCHEDULED_DISPATCH_LEAD_MINUTES = Math.min(
  Math.max(Number(process.env.TAXI_SCHEDULED_DISPATCH_LEAD_MINUTES ?? 15), 5),
  120
);

export type DueScheduledRide = {
  id: string;
  taxi_ride_id: string;
  scheduled_pickup_at: string;
};

export async function findDueTaxiScheduledRides(
  supabase: SupabaseClient,
  limit = 25
): Promise<DueScheduledRide[]> {
  const leadMs = TAXI_SCHEDULED_DISPATCH_LEAD_MINUTES * 60 * 1000;
  const dispatchBefore = new Date(Date.now() + leadMs).toISOString();

  const { data, error } = await supabase
    .from("taxi_scheduled_rides")
    .select("id, taxi_ride_id, scheduled_pickup_at, taxi_rides!inner(payment_status, driver_id, status)")
    .eq("status", "scheduled")
    .lte("scheduled_pickup_at", dispatchBefore)
    .order("scheduled_pickup_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .filter((row) => {
      const ride = row.taxi_rides as {
        payment_status?: string | null;
        driver_id?: string | null;
        status?: string | null;
      } | null;
      return (
        String(ride?.payment_status ?? "").toLowerCase() === "paid" &&
        !ride?.driver_id &&
        String(ride?.status ?? "").toLowerCase() === "scheduled"
      );
    })
    .map((row) => ({
      id: String(row.id),
      taxi_ride_id: String(row.taxi_ride_id),
      scheduled_pickup_at: String(row.scheduled_pickup_at),
    }));
}

export async function dispatchDueTaxiScheduledRide(params: {
  supabase: SupabaseClient;
  scheduledId: string;
  origin: string;
}) {
  const { supabase, scheduledId, origin } = params;

  const { data, error } = await supabase.rpc("dispatch_due_taxi_scheduled_ride", {
    p_scheduled_id: scheduledId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === false) {
    throw new Error(String(result.message ?? "dispatch_due_failed"));
  }

  const taxiRideId = String(result.taxi_ride_id ?? "");
  if (!taxiRideId) {
    return result;
  }

  const { data: ride } = await supabase
    .from("taxi_rides")
    .select("preferred_driver_id")
    .eq("id", taxiRideId)
    .maybeSingle();

  await triggerTaxiRideDispatch({
    origin,
    taxiRideId,
    wave: resolveInitialTaxiDispatchWave(ride ?? {}),
  });

  return result;
}
