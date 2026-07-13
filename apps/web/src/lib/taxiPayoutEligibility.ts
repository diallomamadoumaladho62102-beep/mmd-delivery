/**
 * Pure eligibility helpers for Taxi driver payouts (cron + taxi-run).
 */

export type TaxiPayoutEligibilityInput = {
  rideStatus: string | null | undefined;
  paymentStatus: string | null | undefined;
  refundStatus: string | null | undefined;
  driverId: string | null | undefined;
  driverCents: number | null | undefined;
  driverPaidOut: boolean | null | undefined;
  driverTransferId: string | null | undefined;
  completedAt: string | null | undefined;
  holdUntilMs?: number;
  nowMs?: number;
  connectReady?: boolean | null;
};

export type TaxiPayoutEligibilityResult =
  | { ok: true; alreadyPaid: boolean }
  | { ok: false; reason: string };

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function evaluateTaxiPayoutEligibility(
  input: TaxiPayoutEligibilityInput
): TaxiPayoutEligibilityResult {
  if (input.driverPaidOut === true && String(input.driverTransferId ?? "").trim()) {
    return { ok: true, alreadyPaid: true };
  }

  if (lower(input.rideStatus) !== "completed") {
    return { ok: false, reason: "ride_not_completed" };
  }

  if (lower(input.paymentStatus) !== "paid") {
    return { ok: false, reason: "ride_not_paid" };
  }

  const refund = lower(input.refundStatus);
  if (refund === "refunded" || refund === "partially_refunded" || refund === "disputed") {
    return { ok: false, reason: "refund_or_dispute" };
  }

  if (!String(input.driverId ?? "").trim()) {
    return { ok: false, reason: "missing_driver" };
  }

  const amount = Math.round(Number(input.driverCents ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  if (typeof input.holdUntilMs === "number" && Number.isFinite(input.holdUntilMs)) {
    const now = typeof input.nowMs === "number" ? input.nowMs : Date.now();
    const completedMs = input.completedAt
      ? new Date(input.completedAt).getTime()
      : NaN;
    if (!Number.isFinite(completedMs)) {
      return { ok: false, reason: "missing_completed_at" };
    }
    if (completedMs + input.holdUntilMs > now) {
      return { ok: false, reason: "hold_window" };
    }
  }

  if (input.connectReady === false) {
    return { ok: false, reason: "connect_not_ready" };
  }

  return { ok: true, alreadyPaid: false };
}
