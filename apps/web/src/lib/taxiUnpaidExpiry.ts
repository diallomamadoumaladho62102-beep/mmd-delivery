/** Default payment window for a newly created unpaid taxi ride. */
export const TAXI_UNPAID_TTL_MS = 30 * 60 * 1000;

/** Extended window once Stripe Checkout (or local MM) has started. */
export const TAXI_PENDING_PAYMENT_TTL_MS = 45 * 60 * 1000;

export function taxiUnpaidExpiresAt(now = new Date()): string {
  return new Date(now.getTime() + TAXI_UNPAID_TTL_MS).toISOString();
}

export function taxiPendingPaymentExpiresAt(now = new Date()): string {
  return new Date(now.getTime() + TAXI_PENDING_PAYMENT_TTL_MS).toISOString();
}

/** Ride statuses that may still be expired for non-payment. */
export function isTaxiExpirableStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return (
    s === "draft" ||
    s === "quoted" ||
    s === "pending_payment" ||
    s === "scheduled"
  );
}
