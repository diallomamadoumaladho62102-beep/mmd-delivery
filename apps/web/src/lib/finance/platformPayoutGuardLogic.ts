/**
 * Pure platform bank-payout guard helpers (no Stripe I/O).
 */

import { isTaxiSctHistoricallyClosed } from "@/lib/finance/taxiSctClosure";

export const PLATFORM_PAYOUT_GUARD_BLOCK =
  "block_platform_payout_until_driver_sct" as const;
export const PLATFORM_PAYOUT_GUARD_CLEAR = "clear" as const;

export type PlatformPayoutGuardState =
  | typeof PLATFORM_PAYOUT_GUARD_BLOCK
  | typeof PLATFORM_PAYOUT_GUARD_CLEAR;

export function evaluatePlatformPayoutGuard(params: {
  unpaidDriverCents: number;
}): PlatformPayoutGuardState {
  return params.unpaidDriverCents > 0
    ? PLATFORM_PAYOUT_GUARD_BLOCK
    : PLATFORM_PAYOUT_GUARD_CLEAR;
}

/** True when a single SCT amount can be funded from platform available. */
export function canFundDriverSctFromPlatformAvailable(params: {
  driverCents: number;
  platformAvailableCents: number;
}): boolean {
  const need = Math.max(0, Math.floor(Number(params.driverCents) || 0));
  const avail = Math.floor(Number(params.platformAvailableCents) || 0);
  return need > 0 && avail >= need;
}

export function classifyUnpaidDriverSctStatus(params: {
  driverCents: number;
  platformAvailableCents: number;
  driverTransferId?: string | null;
  sctClosureStatus?: string | null;
}): {
  status: string;
  action_required: string | null;
  can_retry_now: boolean;
} {
  if (String(params.driverTransferId ?? "").trim().startsWith("tr_")) {
    return {
      status: "transferred",
      action_required: null,
      can_retry_now: false,
    };
  }
  if (isTaxiSctHistoricallyClosed(params.sctClosureStatus)) {
    return {
      status: "legacy_closed",
      action_required: null,
      can_retry_now: false,
    };
  }
  const can = canFundDriverSctFromPlatformAvailable({
    driverCents: params.driverCents,
    platformAvailableCents: params.platformAvailableCents,
  });
  if (!can) {
    return {
      status: "driver_payment_pending_insufficient_platform_balance",
      action_required:
        "ensure_platform_payouts_manual_then_retry_when_available_ge_driver_share",
      can_retry_now: false,
    };
  }
  return {
    status: "driver_payment_pending_ready_for_sct",
    action_required: "run_taxi_payouts_or_taxi_run",
    can_retry_now: true,
  };
}

/** Hard gate for any MMD platform→bank payout create path. */
export function assertPlatformBankPayoutAllowed(params: {
  unpaidDriverCents: number;
}): { ok: true } | { ok: false; error: string; guard: PlatformPayoutGuardState } {
  const guard = evaluatePlatformPayoutGuard({
    unpaidDriverCents: params.unpaidDriverCents,
  });
  if (guard === PLATFORM_PAYOUT_GUARD_BLOCK) {
    return {
      ok: false,
      error: "platform_payout_blocked_unpaid_driver_sct",
      guard,
    };
  }
  return { ok: true };
}
