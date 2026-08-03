/**
 * Phase 5B — PE-owned Ride (taxi) final price snapshot.
 * Formula mirrored from legacy calculateTaxiFinalPriceSnapshot.
 */
import { getPricingBusinessDefault } from "../../config/businessDefaults";

export type EngineTaxiFinalPriceSnapshot = {
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

export function computeTaxiFinalPrice(
  input: {
    subtotal_cents: number;
    tax_cents: number;
    gross_total_cents?: number;
    promo_discount_cents?: number;
    loyalty_discount_cents?: number;
    shared_discount_cents?: number;
    mmd_credit_cents?: number;
    mmd_plus_discount_cents?: number;
    shared_ride?: boolean;
  }
): EngineTaxiFinalPriceSnapshot {
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
    const sharedPct = getPricingBusinessDefault("taxi_shared_ride_discount_percent");
    shared_discount_cents = Math.round(gross_total_cents * (sharedPct / 100));
  }

  const promo_discount_cents = Math.max(
    0,
    Math.round(Number(input.promo_discount_cents ?? 0))
  );
  const loyalty_discount_cents = Math.max(
    0,
    Math.round(Number(input.loyalty_discount_cents ?? 0))
  );
  const mmd_credit_cents = Math.max(
    0,
    Math.round(Number(input.mmd_credit_cents ?? 0))
  );
  const mmd_plus_discount_cents = Math.max(
    0,
    Math.round(Number(input.mmd_plus_discount_cents ?? 0))
  );

  const total_discount_cents =
    promo_discount_cents +
    loyalty_discount_cents +
    shared_discount_cents +
    mmd_credit_cents +
    mmd_plus_discount_cents;
  const total_cents = Math.max(0, gross_total_cents - total_discount_cents);

  return {
    subtotal_cents,
    tax_cents,
    gross_total_cents,
    promo_discount_cents,
    loyalty_discount_cents,
    shared_discount_cents,
    mmd_credit_cents,
    mmd_plus_discount_cents,
    total_discount_cents,
    total_cents,
  };
}
