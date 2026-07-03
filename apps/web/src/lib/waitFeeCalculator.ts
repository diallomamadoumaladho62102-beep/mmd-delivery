import {
  WAIT_FEE_MAX_CENTS,
  WAIT_FEE_TIER1_MINUTES,
  WAIT_FEE_TIER1_RATE_CENTS,
  WAIT_FEE_TIER2_MINUTES,
  WAIT_FEE_TIER2_RATE_CENTS,
  WAIT_TIMER_FREE_MINUTES,
  type WaitFeeStatus,
  type WaitTimerComputed,
} from "@/lib/waitTimerTypes";

const TOTAL_BILLABLE_CAP_MINUTES = WAIT_FEE_TIER1_MINUTES + WAIT_FEE_TIER2_MINUTES;

export function computeWaitFeeCents(billableMinutes: number): number {
  const minutes = Math.max(0, Math.floor(billableMinutes));
  if (minutes <= 0) return 0;

  const tier1Minutes = Math.min(minutes, WAIT_FEE_TIER1_MINUTES);
  const tier2Minutes = Math.min(
    Math.max(0, minutes - WAIT_FEE_TIER1_MINUTES),
    WAIT_FEE_TIER2_MINUTES
  );

  const fee =
    tier1Minutes * WAIT_FEE_TIER1_RATE_CENTS + tier2Minutes * WAIT_FEE_TIER2_RATE_CENTS;
  return Math.min(fee, WAIT_FEE_MAX_CENTS);
}

export function computeWaitTimerState(input: {
  waitTimerStartedAt: string | Date | null;
  freeWaitMinutes?: number;
  now?: Date;
  leaveAtDoor?: boolean;
  entityKind: "delivery" | "taxi";
  driverArrivedAt?: string | Date | null;
}): WaitTimerComputed {
  const now = input.now ?? new Date();
  const freeWaitMinutes = input.freeWaitMinutes ?? WAIT_TIMER_FREE_MINUTES;

  if (!input.waitTimerStartedAt && !input.driverArrivedAt) {
    return {
      elapsed_seconds: 0,
      elapsed_minutes: 0,
      free_wait_minutes: freeWaitMinutes,
      billable_minutes: 0,
      wait_fee_cents: 0,
      wait_fee_dollars: 0,
      wait_fee_status: "none",
      max_fee_reached: false,
      can_charge_fees: false,
      can_deposit_at_door: false,
      can_cancel_no_penalty: false,
      remaining_free_seconds: freeWaitMinutes * 60,
    };
  }

  const startedAt = new Date(input.waitTimerStartedAt ?? input.driverArrivedAt ?? now);
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const elapsedMinutes = elapsedSeconds / 60;
  const billableMinutes = Math.max(0, elapsedMinutes - freeWaitMinutes);
  const waitFeeCents = computeWaitFeeCents(billableMinutes);
  const maxFeeReached = billableMinutes >= TOTAL_BILLABLE_CAP_MINUTES;

  let waitFeeStatus: WaitFeeStatus = "none";
  if (elapsedMinutes <= 0) {
    waitFeeStatus = "none";
  } else if (billableMinutes <= 0) {
    waitFeeStatus = "free";
  } else if (maxFeeReached) {
    waitFeeStatus = "capped";
  } else {
    waitFeeStatus = "accruing";
  }

  const remainingFreeSeconds = Math.max(
    0,
    Math.floor(freeWaitMinutes * 60 - elapsedSeconds)
  );

  const canDepositAtDoor =
    input.entityKind === "delivery" &&
    Boolean(input.leaveAtDoor) &&
    maxFeeReached;

  const canCancelNoPenalty =
    input.entityKind === "taxi" && maxFeeReached;

  return {
    elapsed_seconds: elapsedSeconds,
    elapsed_minutes: Math.floor(elapsedMinutes),
    free_wait_minutes: freeWaitMinutes,
    billable_minutes: Math.floor(billableMinutes),
    wait_fee_cents: waitFeeCents,
    wait_fee_dollars: waitFeeCents / 100,
    wait_fee_status: waitFeeStatus,
    max_fee_reached: maxFeeReached,
    can_charge_fees: billableMinutes > 0,
    can_deposit_at_door: canDepositAtDoor,
    can_cancel_no_penalty: canCancelNoPenalty,
    remaining_free_seconds: remainingFreeSeconds,
  };
}
