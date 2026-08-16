/**
 * Restaurant Wallet SoT — Stripe Transfer id is the paid gate (Taxi/Delivery driver parity).
 */

export function isBlockedRestaurantRefundStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return (
    s === "refunded" ||
    s === "partially_refunded" ||
    s === "disputed"
  );
}

/** Awaiting platform→Connect SCT when delivered + paid and no live restaurant Transfer id. */
export function isRestaurantOrderAwaitingTransfer(row: {
  status?: unknown;
  payment_status?: unknown;
  refund_status?: unknown;
  restaurant_transfer_id?: unknown;
}): boolean {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status !== "delivered" && status !== "completed") return false;
  if (String(row.payment_status ?? "").trim().toLowerCase() !== "paid") return false;
  if (isBlockedRestaurantRefundStatus(row.refund_status)) return false;
  return String(row.restaurant_transfer_id ?? "").trim().length === 0;
}

/** Dollars from order_commissions.restaurant_cents (preferred) or legacy restaurant_net_amount. */
export function restaurantAwaitingDollars(row: {
  restaurant_cents?: unknown;
  restaurant_net_amount?: unknown;
}): number {
  const cents = Number(row.restaurant_cents);
  if (Number.isFinite(cents) && cents > 0) return cents / 100;
  const net = Number(row.restaurant_net_amount);
  return Number.isFinite(net) && net > 0 ? net : 0;
}
