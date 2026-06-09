export const TAXI_SHARED_RIDE_DISCOUNT_PERCENT = 15;
export const TAXI_SHARED_RIDE_MATCH_WINDOW_MINUTES = 15;

export async function resolveTaxiSharedDispatchTarget(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
