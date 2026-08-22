export type DeliveryRequestAmountSource = {
  total_cents?: unknown;
  total?: unknown;
  currency?: unknown;
  net_charge_cents?: unknown;
};

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Prefer frozen net charge (MMD credit) when present — matches Stripe webhook settlement. */
export function resolveDeliveryRequestAmountCents(
  row: DeliveryRequestAmountSource
): number | null {
  const netCharge = toPositiveNumber(row.net_charge_cents);
  const grossForNet = toPositiveNumber(row.total_cents);
  if (netCharge != null && (grossForNet == null || netCharge <= grossForNet)) {
    return Math.round(netCharge);
  }

  const totalCents = toPositiveNumber(row.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(row.total);
  if (total != null) return Math.round(total * 100);

  return null;
}

export function normalizeCurrencyCode(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw || "usd";
}
