import { computeWaitTimerState } from "@/lib/waitFeeCalculator";
import { WAIT_FEE_MAX_CENTS } from "@/lib/waitTimerTypes";

/**
 * How many cents to add to the captured trip total.
 * Zero when the fee was already applied or already charged, so a retry cannot add it twice.
 * Promotions stay on the quoted total. The wait fee is added after that total.
 */
export function taxiWaitCentsToApply(input: {
  feeCents: number;
  alreadyApplied: boolean;
}): number {
  if (input.alreadyApplied) return 0;
  return Math.max(0, Math.floor(input.feeCents));
}

export function buildTaxiCustomerWaitView(input: {
  status: string;
  waitTimerStartedAt: string | null;
  driverArrivedAt: string | null;
  startedAt: string | null;
  freeWaitMinutes: number | null;
  storedWaitFeeCents: number | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const status = String(input.status ?? "").toLowerCase();
  const tripStarted = Boolean(input.startedAt) || status === "in_progress" || status === "completed";
  const arrived = Boolean(input.waitTimerStartedAt || input.driverArrivedAt);
  const computed = computeWaitTimerState({
    waitTimerStartedAt: input.waitTimerStartedAt,
    driverArrivedAt: input.driverArrivedAt,
    freeWaitMinutes: input.freeWaitMinutes ?? undefined,
    waitEndedAt: tripStarted ? input.startedAt : null,
    now,
    entityKind: "taxi",
  });
  const active = arrived && status === "driver_arrived" && !input.startedAt;
  const finalFee = tripStarted ? computed.wait_fee_cents : null;

  return {
    waiting: active,
    server_now: now.toISOString(),
    wait_started_at: input.waitTimerStartedAt ?? input.driverArrivedAt,
    trip_started_at: input.startedAt,
    free_wait_minutes: computed.free_wait_minutes,
    elapsed_seconds: computed.elapsed_seconds,
    remaining_free_seconds: computed.remaining_free_seconds,
    billable_minutes: computed.billable_minutes,
    wait_fee_cents: computed.wait_fee_cents,
    max_wait_fee_cents: WAIT_FEE_MAX_CENTS,
    max_fee_reached: computed.max_fee_reached,
    wait_active: active,
    trip_started: tripStarted,
    final_wait_fee_cents: finalFee,
    stored_wait_fee_cents: Math.max(0, Math.floor(Number(input.storedWaitFeeCents ?? 0))),
  };
}
