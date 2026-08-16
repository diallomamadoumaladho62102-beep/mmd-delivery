/**
 * Delivery Wallet SoT helpers — Stripe Transfer id is the paid gate (same as Taxi).
 */

export function isBlockedDeliveryRefundStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return (
    s === "refunded" ||
    s === "partially_refunded" ||
    s === "disputed"
  );
}

export function isPaidDeliveryPaymentStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

/**
 * Awaiting platform→Connect SCT when delivered + paid and no live Transfer id.
 * Internal flags (driver_paid_out / driver_payout_id) are NOT sufficient.
 */
export function isDeliveryOrderAwaitingTransfer(row: {
  status?: unknown;
  payment_status?: unknown;
  refund_status?: unknown;
  driver_transfer_id?: unknown;
}): boolean {
  if (String(row.status ?? "").trim().toLowerCase() !== "delivered") {
    return false;
  }
  if (!isPaidDeliveryPaymentStatus(row.payment_status)) return false;
  if (isBlockedDeliveryRefundStatus(row.refund_status)) return false;
  const transferId = String(row.driver_transfer_id ?? "").trim();
  return transferId.length === 0;
}
