export type OrderAmountSource = {
  total_cents?: unknown;
  total?: unknown;
  grand_total?: unknown;
};

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function resolveOrderAmountCents(order: OrderAmountSource): number | null {
  const totalCents = toPositiveNumber(order.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(order.total);
  if (total != null) return Math.round(total * 100);

  const grandTotal = toPositiveNumber(order.grand_total);
  if (grandTotal != null) return Math.round(grandTotal * 100);

  return null;
}
