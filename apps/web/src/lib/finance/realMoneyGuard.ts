/**
 * Backend real-money gate. Fake/test/demo/archived trips must never enter
 * SCT, balances, earnings, or Sunday bank payout calculations.
 *
 * Source of truth is trip visibility + confirmed payment — not the frontend.
 */
import {
  isLiveVisibleTrip,
  type TripVisibilityFlags,
} from "@/lib/tripVisibility";

export type RealMoneyPaymentFlags = {
  payment_status?: unknown;
  refund_status?: unknown;
};

export type RealMoneyOrderFlags = TripVisibilityFlags &
  RealMoneyPaymentFlags & {
    status?: unknown;
    stripe_payment_intent_id?: unknown;
    stripe_session_id?: unknown;
  };

const CONFIRMED_PAYMENT = new Set(["paid", "succeeded"]);
const BLOCKED_REFUND = new Set([
  "refunded",
  "partially_refunded",
  "disputed",
]);
const BLOCKED_ORDER_STATUS = new Set(["canceled", "cancelled"]);

export function isConfirmedRealPayment(
  row: RealMoneyPaymentFlags | null | undefined,
): boolean {
  const status = String(row?.payment_status ?? "")
    .trim()
    .toLowerCase();
  return CONFIRMED_PAYMENT.has(status);
}

export function isBlockedFinancialRefund(
  row: { refund_status?: unknown } | null | undefined,
): boolean {
  const status = String(row?.refund_status ?? "")
    .trim()
    .toLowerCase();
  return BLOCKED_REFUND.has(status);
}

export function isBlockedFinancialOrderStatus(
  row: { status?: unknown } | null | undefined,
): boolean {
  const status = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  return BLOCKED_ORDER_STATUS.has(status);
}

/** Live, non-test trip that is eligible to enter the real-money ledger. */
export function isRealMoneyTrip(
  row: TripVisibilityFlags | null | undefined,
): boolean {
  return isLiveVisibleTrip(row);
}

/**
 * Order/ride that may create earnings, SCT, or payouts.
 * Test / archived / hidden / unpaid / refunded rows are excluded.
 */
export function isRealMoneyFinancialSource(
  row: RealMoneyOrderFlags | null | undefined,
): boolean {
  if (!isRealMoneyTrip(row)) return false;
  if (isBlockedFinancialOrderStatus(row)) return false;
  if (!isConfirmedRealPayment(row)) return false;
  if (isBlockedFinancialRefund(row)) return false;
  return true;
}

export function realMoneyBlockReason(
  row: RealMoneyOrderFlags | null | undefined,
): string | null {
  if (!row) return "missing_source";
  if (row.is_test === true) return "test_or_demo_excluded";
  if (row.hidden_from_user === true) return "hidden_from_user_excluded";
  if (row.archived_at) return "archived_excluded";
  if (isBlockedFinancialOrderStatus(row)) return "cancelled_excluded";
  if (!isConfirmedRealPayment(row)) return "payment_not_confirmed";
  if (isBlockedFinancialRefund(row)) return "refund_or_dispute_excluded";
  return null;
}
