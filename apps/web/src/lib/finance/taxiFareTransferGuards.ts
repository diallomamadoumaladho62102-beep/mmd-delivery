/**
 * Guards for taxi fare platform→Connect Transfers (SCT).
 * Prevents a reversed Transfer from being treated as a successful payout on retry.
 */

export type TaxiFareTransferLike = {
  id?: string | null;
  reversed?: boolean | null;
  amount?: number | null;
  amount_reversed?: number | null;
  created?: number | null;
};

/** True when Stripe reports the transfer as fully reversed (no usable credit). */
export function isStripeTransferReversed(
  transfer: TaxiFareTransferLike | null | undefined,
): boolean {
  if (!transfer) return false;
  if (transfer.reversed === true) return true;
  const amount = Math.max(0, Math.round(Number(transfer.amount ?? 0)));
  const amountReversed = Math.max(
    0,
    Math.round(Number(transfer.amount_reversed ?? 0)),
  );
  return amount > 0 && amountReversed >= amount;
}

/**
 * Idempotency key for taxi fare SCT.
 * After a reverse, the key MUST change so Stripe cannot return the reversed Transfer.
 */
export function buildTaxiFareTransferIdempotencyKey(
  rideId: string,
  afterReversedTransferId: string | null = null,
): string {
  const id = String(rideId ?? "").trim();
  const after = String(afterReversedTransferId ?? "").trim();
  if (after) {
    return `taxi_driver_payout:${id}:after:${after}`;
  }
  return `taxi_driver_payout:${id}`;
}

export function taxiFareTransferGroup(rideId: string): string {
  return `taxi_ride:${String(rideId ?? "").trim()}`;
}

export type TaxiFareTransferReusePlan = {
  /** Non-reversed Transfer already on Stripe for this ride — reuse, do not create. */
  reusableTransferId: string | null;
  /** Latest reversed Transfer id — used to mint a new idempotency key for retry. */
  afterReversedTransferId: string | null;
};

/**
 * Decide whether to reuse an existing Stripe Transfer or mint a post-reverse key.
 * Prefer the newest non-reversed Transfer; otherwise key off the newest reversed id.
 */
export function resolveTaxiFareTransferReusePlan(
  transfers: TaxiFareTransferLike[],
): TaxiFareTransferReusePlan {
  const sorted = [...transfers].sort(
    (a, b) => Number(b.created ?? 0) - Number(a.created ?? 0),
  );

  const active = sorted.find(
    (t) => String(t.id ?? "").trim() && !isStripeTransferReversed(t),
  );
  if (active) {
    return {
      reusableTransferId: String(active.id).trim(),
      afterReversedTransferId: null,
    };
  }

  const reversed = sorted.find(
    (t) => String(t.id ?? "").trim() && isStripeTransferReversed(t),
  );
  return {
    reusableTransferId: null,
    afterReversedTransferId: reversed
      ? String(reversed.id).trim()
      : null,
  };
}
