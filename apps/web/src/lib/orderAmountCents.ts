export type OrderAmountSource = {
  total_cents?: unknown;
  total?: unknown;
  grand_total?: unknown;
  net_charge_cents?: unknown;
};

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Prefer frozen net charge (MMD credit) when present — matches Stripe webhook settlement. */
export function resolveOrderAmountCents(order: OrderAmountSource): number | null {
  const netCharge = toPositiveNumber(order.net_charge_cents);
  const grossForNet = toPositiveNumber(order.total_cents);
  if (netCharge != null && (grossForNet == null || netCharge <= grossForNet)) {
    return Math.round(netCharge);
  }

  const totalCents = toPositiveNumber(order.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(order.total);
  if (total != null) return Math.round(total * 100);

  const grandTotal = toPositiveNumber(order.grand_total);
  if (grandTotal != null) return Math.round(grandTotal * 100);

  return null;
}
