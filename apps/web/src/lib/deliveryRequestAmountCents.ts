export type DeliveryRequestAmountSource = {
  total_cents?: unknown;
  total?: unknown;
  currency?: unknown;
};

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function resolveDeliveryRequestAmountCents(
  row: DeliveryRequestAmountSource
): number | null {
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
