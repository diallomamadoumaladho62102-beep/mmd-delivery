import { computeWaitTimerState } from "@/lib/waitFeeCalculator";

/** Read-only snapshot of the existing wait timer. Does not change the fee. */
export type TaxiWaitRideSlice = {
  wait_timer_started_at?: string | null;
  driver_arrived_at?: string | null;
  started_at?: string | null;
  free_wait_minutes?: number | null;
  wait_fee_amount_cents?: number | null;
  wait_fee_applied_to_total?: boolean | null;
  driver_distance_to_target_meters?: number | null;
};

export function taxiWaitAuditFromRide(ride: TaxiWaitRideSlice, now = new Date()) {
  const computed = computeWaitTimerState({
    waitTimerStartedAt: ride.wait_timer_started_at ?? null,
    driverArrivedAt: ride.driver_arrived_at ?? null,
    waitEndedAt: ride.started_at ?? null,
    freeWaitMinutes:
      typeof ride.free_wait_minutes === "number" ? ride.free_wait_minutes : undefined,
    now,
    entityKind: "taxi",
  });
  const storedFee = Number(ride.wait_fee_amount_cents ?? 0);
  const collected = ride.wait_fee_applied_to_total === true;
  const chargedFee = collected && Number.isFinite(storedFee) ? Math.max(0, Math.floor(storedFee)) : 0;

  return {
    waitMinutes: computed.elapsed_minutes,
    waitFeeCents: chargedFee,
    metadata: {
      free_wait_minutes: computed.free_wait_minutes,
      total_wait_minutes: computed.elapsed_minutes,
      billable_wait_minutes: computed.billable_minutes,
      accrued_wait_fee_cents: computed.wait_fee_cents,
      wait_fee_finalized: collected,
      wait_fee_collected: collected,
      wait_fee_waived: !collected && computed.wait_fee_cents > 0,
      driver_arrived_at: ride.driver_arrived_at ?? null,
      wait_timer_started_at: ride.wait_timer_started_at ?? null,
      started_at: ride.started_at ?? null,
      gps_distance_meters: ride.driver_distance_to_target_meters ?? null,
    },
  };
}
