/**
 * Guards for food/package order platform→Connect Transfers (SCT via transfers/run).
 * Mirrors taxiFareTransferGuards: a reversed Transfer must never stay "paid".
 */

import { isStripeTransferReversed } from "@/lib/finance/taxiFareTransferGuards";

export { isStripeTransferReversed };

export type OrderPayoutTarget = "restaurant" | "driver";

/**
 * Idempotency key for order SCT.
 * After a reverse, the key MUST change so Stripe cannot return the reversed Transfer.
 */
export function buildOrderTransferIdempotencyKey(
  orderId: string,
  target: OrderPayoutTarget,
  afterReversedTransferId: string | null = null,
): string {
  const id = String(orderId ?? "").trim();
  const t = target === "restaurant" ? "restaurant" : "driver";
  const after = String(afterReversedTransferId ?? "").trim();
  if (after) {
    return `transfer:${id}:${t}:after:${after}`;
  }
  return `transfer:${id}:${t}`;
}

export function orderTransferGroup(orderId: string): string {
  return `ORDER_${String(orderId ?? "").trim()}`;
}
