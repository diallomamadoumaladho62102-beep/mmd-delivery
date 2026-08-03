/**
 * Phase 5B — Ride adapter.
 * Legacy side: normalize capture for shadow / fail-open.
 * Engine side: PE-owned taxi final price (no @/lib/taxiFinalPrice import).
 */
import { assembleComparableQuoteFromParts } from "../assembleQuote";
import { computeTaxiFinalPrice } from "../compute/taxiFinalPrice";
import type { ComparableQuote } from "../../shadow/comparableQuote";

export type TaxiQuoteCapture = {
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  service_fee_cents?: number;
  platform_fee_cents?: number;
  driver_payout_cents?: number;
  shared_ride?: boolean;
  shared_discount_cents?: number;
  promo_discount_cents?: number;
  loyalty_discount_cents?: number;
  mmd_credit_cents?: number;
  mmd_plus_discount_cents?: number;
  total_cents: number;
};

/**
 * Ride comparable pair.
 * Engine customer total / promotions come from PE computeTaxiFinalPrice.
 */
export function buildRideComparablePair(capture: TaxiQuoteCapture): {
  legacy: ComparableQuote;
  engine: ComparableQuote;
} {
  const serviceFee = Math.round(Number(capture.service_fee_cents ?? 0));
  const capturePromo =
    Math.round(Number(capture.promo_discount_cents ?? 0)) +
    Math.round(Number(capture.loyalty_discount_cents ?? 0)) +
    Math.round(Number(capture.shared_discount_cents ?? 0)) +
    Math.round(Number(capture.mmd_credit_cents ?? 0)) +
    Math.round(Number(capture.mmd_plus_discount_cents ?? 0));

  const subtotal = Math.round(capture.subtotal_cents);
  const tax = Math.round(capture.tax_cents);
  const total = Math.round(capture.total_cents);

  const driver =
    capture.driver_payout_cents == null
      ? null
      : Math.round(capture.driver_payout_cents);
  const platformCore =
    capture.platform_fee_cents == null
      ? null
      : Math.round(capture.platform_fee_cents);
  const platformRevenue =
    platformCore == null ? tax + serviceFee : platformCore + tax + serviceFee;

  const legacyParts = assembleComparableQuoteFromParts({
    service: "ride",
    currency: capture.currency,
    baseCents: subtotal,
    taxCents: tax,
    feeCents: serviceFee,
    promotionCents: capturePromo,
    customerTotalCents: total,
    driverEarningsCents: driver,
    restaurantEarningsCents: null,
    sellerEarningsCents: null,
    platformRevenueCents: platformRevenue,
    legacyVersion: "legacy-taxi-v1",
    meta: { side: "legacy" },
  });
  if (!legacyParts.ok) throw new Error(legacyParts.reason);

  const peSnap = computeTaxiFinalPrice({
    subtotal_cents: subtotal,
    tax_cents: tax,
    gross_total_cents: subtotal + tax + serviceFee,
    promo_discount_cents: capture.promo_discount_cents,
    loyalty_discount_cents: capture.loyalty_discount_cents,
    shared_discount_cents: capture.shared_discount_cents,
    mmd_credit_cents: capture.mmd_credit_cents,
    mmd_plus_discount_cents: capture.mmd_plus_discount_cents,
    shared_ride:
      capture.shared_ride === true &&
      !(Number(capture.shared_discount_cents) > 0),
  });

  const engineParts = assembleComparableQuoteFromParts({
    service: "ride",
    currency: capture.currency,
    baseCents: peSnap.subtotal_cents,
    taxCents: peSnap.tax_cents,
    feeCents: serviceFee,
    promotionCents: peSnap.total_discount_cents,
    customerTotalCents: peSnap.total_cents,
    driverEarningsCents: driver,
    restaurantEarningsCents: null,
    sellerEarningsCents: null,
    platformRevenueCents: platformRevenue,
    legacyVersion: "legacy-taxi-v1",
    meta: {
      side: "engine",
      sot: "pricing-engine",
      pe_total_cents: peSnap.total_cents,
      pe_discount_cents: peSnap.total_discount_cents,
      pe_gross_total_cents: peSnap.gross_total_cents,
    },
  });
  if (!engineParts.ok) throw new Error(engineParts.reason);

  return { legacy: legacyParts.quote, engine: engineParts.quote };
}
