import { resolveInitialTaxiDispatchWave } from "@/lib/taxiPremiumDispatch";
import { triggerTaxiRideDispatch } from "@/lib/scheduleTaxiRideDispatch";
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";

export const TAXI_SHARED_RIDE_DISCOUNT_PERCENT = getPricingBusinessDefault(
  "taxi_shared_ride_discount_percent"
);
export const TAXI_SHARED_RIDE_MATCH_WINDOW_MINUTES = getPricingBusinessDefault(
  "taxi_shared_ride_match_window_minutes"
);

export type TaxiDispatchRetryDecision = {
  shouldRetry: boolean;
  dispatchRideId: string;
  skipReason?: string;
};

export async function resolveTaxiDispatchRetryDecision(params: {
   
  supabase: any;
  taxiRideId: string;
}): Promise<TaxiDispatchRetryDecision> {
  const { supabase, taxiRideId } = params;

  const { data: ride, error: rideError } = await supabase
    .from("taxi_rides")
    .select("id,shared_ride_id,is_shared_ride,is_scheduled")
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideError || !ride) {
    return { shouldRetry: false, dispatchRideId: taxiRideId, skipReason: "ride_not_found" };
  }

  if (!ride.shared_ride_id) {
    return { shouldRetry: true, dispatchRideId: taxiRideId };
  }

  const { data: shared, error: sharedError } = await supabase
    .from("taxi_shared_rides")
    .select("primary_taxi_ride_id")
    .eq("id", ride.shared_ride_id)
    .maybeSingle();

  if (sharedError || !shared?.primary_taxi_ride_id) {
    return {
      shouldRetry: false,
      dispatchRideId: taxiRideId,
      skipReason: "shared_ride_not_found",
    };
  }

  const primaryId = String(shared.primary_taxi_ride_id);

  if (taxiRideId !== primaryId) {
    return {
      shouldRetry: false,
      dispatchRideId: primaryId,
      skipReason: "shared_secondary_segment",
    };
  }

  const dispatchTarget = await resolveTaxiSharedDispatchTarget({
    supabase,
    taxiRideId: primaryId,
  });

  if (!dispatchTarget.shouldDispatch) {
    return {
      shouldRetry: false,
      dispatchRideId: primaryId,
      skipReason: "shared_passengers_not_all_paid",
    };
  }

  return { shouldRetry: true, dispatchRideId: primaryId };
}

export async function scheduleTaxiRideDispatchIfEligible(params: {
   
  supabase: any;
  origin: string;
  taxiRideId: string;
  rideForWave: {
    preferred_driver_id?: string | null;
    is_scheduled?: boolean | null;
  };
}): Promise<{
  dispatched: boolean;
  dispatchRideId: string;
  reason?: string;
}> {
  const { supabase, origin, taxiRideId, rideForWave } = params;

  if (rideForWave.is_scheduled) {
    return { dispatched: false, dispatchRideId: taxiRideId, reason: "scheduled" };
  }

  const dispatchTarget = await resolveTaxiSharedDispatchTarget({
    supabase,
    taxiRideId,
  });

  if (!dispatchTarget.shouldDispatch) {
    return {
      dispatched: false,
      dispatchRideId: dispatchTarget.dispatchRideId,
      reason: "shared_dispatch_gate",
    };
  }

  const wave = resolveInitialTaxiDispatchWave(rideForWave);

  const dispatchResult = await triggerTaxiRideDispatch({
    origin,
    taxiRideId: dispatchTarget.dispatchRideId,
    wave,
    supabaseAdmin: supabase,
  });

  if (dispatchResult.ok) {
    return { dispatched: true, dispatchRideId: dispatchTarget.dispatchRideId };
  }

  // In-process fallback when HTTP dispatch secret/network fails — same path as local payments.
  console.warn("[scheduleTaxiRideDispatchIfEligible] HTTP dispatch failed — in-process fallback", {
    taxiRideId: dispatchTarget.dispatchRideId,
    wave,
    error: dispatchResult.error,
  });

  try {
    const { runTaxiRideDispatch } = await import("@/lib/runTaxiRideDispatch");
    const local = await runTaxiRideDispatch({
      supabase,
      taxiRideId: dispatchTarget.dispatchRideId,
      wave,
    });
    if (local.ok) {
      return { dispatched: true, dispatchRideId: dispatchTarget.dispatchRideId };
    }
    return {
      dispatched: false,
      dispatchRideId: dispatchTarget.dispatchRideId,
      reason: local.error ?? dispatchResult.error ?? "dispatch_failed",
    };
  } catch (err) {
    return {
      dispatched: false,
      dispatchRideId: dispatchTarget.dispatchRideId,
      reason:
        err instanceof Error
          ? err.message
          : dispatchResult.error ?? "dispatch_failed",
    };
  }
}

export async function resolveTaxiSharedDispatchTarget(params: {
   
  supabase: any;
  taxiRideId: string;
}): Promise<{ dispatchRideId: string; shouldDispatch: boolean }> {
  const { supabase, taxiRideId } = params;

  const { data: ride, error: rideError } = await supabase
    .from("taxi_rides")
    .select("id,shared_ride_id,is_shared_ride,is_scheduled")
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideError || !ride?.shared_ride_id) {
    return {
      dispatchRideId: taxiRideId,
      shouldDispatch: !ride?.is_scheduled,
    };
  }

  const { data: shared, error: sharedError } = await supabase
    .from("taxi_shared_rides")
    .select("primary_taxi_ride_id")
    .eq("id", ride.shared_ride_id)
    .maybeSingle();

  if (sharedError || !shared?.primary_taxi_ride_id) {
    return { dispatchRideId: taxiRideId, shouldDispatch: false };
  }

  const { data: allPaid, error: paidError } = await supabase.rpc(
    "all_taxi_shared_passengers_paid",
    { p_shared_ride_id: ride.shared_ride_id }
  );

  if (paidError || allPaid !== true) {
    return {
      dispatchRideId: String(shared.primary_taxi_ride_id),
      shouldDispatch: false,
    };
  }

  return {
    dispatchRideId: String(shared.primary_taxi_ride_id),
    shouldDispatch: !ride.is_scheduled,
  };
}
