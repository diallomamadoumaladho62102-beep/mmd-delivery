/**
 * Resolve commission display cents from SoT columns.
 * Prefer *_cents, then *_amount dollars, then legacy fee_*_cents last.
 */
export type CommissionCentsLike = {
  client_cents?: unknown;
  driver_cents?: unknown;
  restaurant_cents?: unknown;
  platform_cents?: unknown;
  client_amount?: unknown;
  driver_amount?: unknown;
  restaurant_amount?: unknown;
  platform_amount?: unknown;
  fee_client_cents?: unknown;
  fee_driver_cents?: unknown;
  fee_restaurant_cents?: unknown;
  fee_platform_cents?: unknown;
};

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 0 ? rounded : null;
}

function dollarsToCents(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function pickCents(
  sotCents: unknown,
  amountDollars: unknown,
  legacyFeeCents: unknown,
): number {
  return (
    positiveInt(sotCents) ??
    dollarsToCents(amountDollars) ??
    positiveInt(legacyFeeCents) ??
    0
  );
}

export function resolveCommissionDisplayCents(row: CommissionCentsLike): {
  client_cents: number;
  driver_cents: number;
  restaurant_cents: number;
  platform_cents: number;
} {
  return {
    client_cents: pickCents(
      row.client_cents,
      row.client_amount,
      row.fee_client_cents,
    ),
    driver_cents: pickCents(
      row.driver_cents,
      row.driver_amount,
      row.fee_driver_cents,
    ),
    restaurant_cents: pickCents(
      row.restaurant_cents,
      row.restaurant_amount,
      row.fee_restaurant_cents,
    ),
    platform_cents: pickCents(
      row.platform_cents,
      row.platform_amount,
      row.fee_platform_cents,
    ),
  };
}
