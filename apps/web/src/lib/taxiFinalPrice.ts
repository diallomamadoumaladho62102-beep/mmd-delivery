/**
 * Taxi price helpers — final net formula owned by Pricing Engine.
 * Ride-row snapshot + drift checks (still used by create / checkout integrity).
 */
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";
import { computeTaxiFinalPrice } from "@/lib/pricingEngine/engine/compute/taxiFinalPrice";

export type TaxiFinalPriceSnapshot = {
  subtotal_cents: number;
  tax_cents: number;
  gross_total_cents: number;
  promo_discount_cents: number;
  loyalty_discount_cents: number;
  shared_discount_cents: number;
  mmd_credit_cents: number;
  mmd_plus_discount_cents: number;
  total_discount_cents: number;
  total_cents: number;
};

export const QUOTE_DRIFT_TOLERANCE_CENTS = getPricingBusinessDefault(
  "taxi_quote_drift_tolerance_cents"
);
export const QUOTE_DRIFT_TOLERANCE_RATIO = getPricingBusinessDefault(
  "taxi_quote_drift_tolerance_ratio"
);

export type TaxiRidePriceFields = {
  subtotal_cents?: number | null;
  tax_cents?: number | null;
  gross_total_cents?: number | null;
  discount_cents?: number | null;
  loyalty_discount_cents?: number | null;
  shared_discount_cents?: number | null;
  mmd_credit_applied_cents?: number | null;
  mmd_plus_discount_cents?: number | null;
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

  return computeTaxiFinalPrice({
    subtotal_cents,
    tax_cents,
    gross_total_cents,
    promo_discount_cents: Number(ride.discount_cents ?? 0),
    loyalty_discount_cents: Number(ride.loyalty_discount_cents ?? 0),
    shared_discount_cents: Number(ride.shared_discount_cents ?? 0),
    mmd_credit_cents: Number(ride.mmd_credit_applied_cents ?? 0),
    mmd_plus_discount_cents: Number(ride.mmd_plus_discount_cents ?? 0),
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
