import { TAXI_SHARED_RIDE_DISCOUNT_PERCENT } from "@/lib/taxiSharedRideDispatch";

export type TaxiFinalPriceSnapshot = {
  subtotal_cents: number;
  tax_cents: number;
  gross_total_cents: number;
  promo_discount_cents: number;
  loyalty_discount_cents: number;
  shared_discount_cents: number;
  total_discount_cents: number;
  total_cents: number;
};

export const QUOTE_DRIFT_TOLERANCE_CENTS = 50;
export const QUOTE_DRIFT_TOLERANCE_RATIO = 0.02;

export function calculateTaxiFinalPriceSnapshot(input: {
  subtotal_cents: number;
  tax_cents: number;
  gross_total_cents?: number;
  promo_discount_cents?: number;
  loyalty_discount_cents?: number;
  shared_discount_cents?: number;
  shared_ride?: boolean;
}): TaxiFinalPriceSnapshot {
  const subtotal_cents = Math.max(0, Math.round(Number(input.subtotal_cents ?? 0)));
  const tax_cents = Math.max(0, Math.round(Number(input.tax_cents ?? 0)));
  const gross_total_cents = Math.max(
    0,
    Math.round(Number(input.gross_total_cents ?? subtotal_cents + tax_cents))
  );

  let shared_discount_cents = Math.max(
    0,
    Math.round(Number(input.shared_discount_cents ?? 0))
  );

  if (
    input.shared_ride === true &&
    input.shared_discount_cents == null &&
    shared_discount_cents === 0
  ) {
    shared_discount_cents = Math.round(
      gross_total_cents * (TAXI_SHARED_RIDE_DISCOUNT_PERCENT / 100)
    );
  }

  const promo_discount_cents = Math.max(
    0,
    Math.round(Number(input.promo_discount_cents ?? 0))
  );
  const loyalty_discount_cents = Math.max(
    0,
    Math.round(Number(input.loyalty_discount_cents ?? 0))
  );

  const total_discount_cents =
    promo_discount_cents + loyalty_discount_cents + shared_discount_cents;
  const total_cents = Math.max(0, gross_total_cents - total_discount_cents);

  return {
    subtotal_cents,
    tax_cents,
    gross_total_cents,
    promo_discount_cents,
    loyalty_discount_cents,
    shared_discount_cents,
    total_discount_cents,
    total_cents,
  };
}

export function snapshotFromQuoteRpc(
  quote: Record<string, unknown>,
  options?: { shared_ride?: boolean }
): TaxiFinalPriceSnapshot {
  return calculateTaxiFinalPriceSnapshot({
    subtotal_cents: Number(quote.subtotal_cents ?? 0),
    tax_cents: Number(quote.tax_cents ?? 0),
    gross_total_cents: Number(quote.total_cents ?? 0),
    shared_ride: options?.shared_ride === true,
  });
}

export type TaxiRidePriceFields = {
  subtotal_cents?: number | null;
  tax_cents?: number | null;
  gross_total_cents?: number | null;
  discount_cents?: number | null;
  loyalty_discount_cents?: number | null;
  shared_discount_cents?: number | null;
  total_cents?: number | null;
};

export function snapshotFromRideRow(ride: TaxiRidePriceFields): TaxiFinalPriceSnapshot {
  const subtotal_cents = Math.round(Number(ride.subtotal_cents ?? 0));
  const tax_cents = Math.round(Number(ride.tax_cents ?? 0));
  const gross_total_cents = Math.round(
    Number(
      ride.gross_total_cents ??
        ride.total_cents ??
        subtotal_cents + tax_cents
    )
  );

  return calculateTaxiFinalPriceSnapshot({
    subtotal_cents,
    tax_cents,
    gross_total_cents,
    promo_discount_cents: Number(ride.discount_cents ?? 0),
    loyalty_discount_cents: Number(ride.loyalty_discount_cents ?? 0),
    shared_discount_cents: Number(ride.shared_discount_cents ?? 0),
  });
}

export function isQuotePriceWithinTolerance(
  expectedNetTotalCents: number,
  actualNetTotalCents: number
): boolean {
  const expected = Math.round(Number(expectedNetTotalCents));
  const actual = Math.round(Number(actualNetTotalCents));

  if (!Number.isFinite(expected) || expected <= 0) return true;
  if (!Number.isFinite(actual) || actual <= 0) return false;

  const diff = Math.abs(actual - expected);
  const maxDiff = Math.max(
    QUOTE_DRIFT_TOLERANCE_CENTS,
    Math.round(expected * QUOTE_DRIFT_TOLERANCE_RATIO)
  );
  return diff <= maxDiff;
}

export function assertTaxiQuotePriceMatches(
  expectedNetTotalCents: number,
  snapshot: TaxiFinalPriceSnapshot
): { ok: true } | { ok: false; error: string; expected_total_cents: number; actual_total_cents: number } {
  const actual = snapshot.total_cents;
  if (
    expectedNetTotalCents > 0 &&
    !isQuotePriceWithinTolerance(expectedNetTotalCents, actual)
  ) {
    return {
      ok: false,
      error: "quote_price_drift",
      expected_total_cents: Math.round(expectedNetTotalCents),
      actual_total_cents: actual,
    };
  }
  return { ok: true };
}
