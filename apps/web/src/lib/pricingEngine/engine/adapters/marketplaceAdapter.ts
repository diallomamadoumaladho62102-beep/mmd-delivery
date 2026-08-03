/**
 * Phase 5B — Marketplace adapter.
 * Legacy side: normalize capture for shadow / fail-open.
 * Engine side: PE-owned delivery fee + checkout total (no @/lib/marketplaceCheckout).
 */
import { assembleComparableQuoteFromParts } from "../assembleQuote";
import { computeMarketplaceCheckoutTotals } from "../compute/marketplaceCheckout";
import type { ComparableQuote } from "../../shadow/comparableQuote";

export type MarketplaceQuoteCapture = {
  currency: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  seller_net_cents?: number | null;
  platform_fee_cents?: number | null;
  driver_earning_cents?: number | null;
};

/**
 * Marketplace comparable pair.
 * Engine recomputes delivery fee + total via PE formula (SoT).
 */
export function buildMarketplaceComparablePair(
  capture: MarketplaceQuoteCapture
): { legacy: ComparableQuote; engine: ComparableQuote } {
  const subtotal = Math.round(capture.subtotal_cents);
  const delivery = Math.round(capture.delivery_fee_cents);
  const serviceFee = Math.round(capture.service_fee_cents);
  const total = Math.round(capture.total_cents);

  const seller =
    capture.seller_net_cents == null
      ? null
      : Math.round(capture.seller_net_cents);
  const driver =
    capture.driver_earning_cents == null
      ? null
      : Math.round(capture.driver_earning_cents);
  const platform =
    capture.platform_fee_cents == null
      ? serviceFee + delivery
      : Math.round(capture.platform_fee_cents) + serviceFee;

  const legacyParts = assembleComparableQuoteFromParts({
    service: "marketplace",
    currency: capture.currency,
    baseCents: subtotal,
    taxCents: 0,
    feeCents: delivery + serviceFee,
    promotionCents: 0,
    customerTotalCents: total,
    driverEarningsCents: driver,
    restaurantEarningsCents: null,
    sellerEarningsCents: seller,
    platformRevenueCents: platform,
    legacyVersion: "legacy-marketplace-shadow-v2",
    meta: { side: "legacy" },
  });
  if (!legacyParts.ok) throw new Error(legacyParts.reason);

  // Engine SoT: PE marketplace formula (no delivery override — formula is SoT).
  const pe = computeMarketplaceCheckoutTotals({
    subtotal_cents: subtotal,
    service_fee_cents: serviceFee,
  });
  const enginePlatform =
    capture.platform_fee_cents == null
      ? pe.service_fee_cents + pe.delivery_fee_cents
      : Math.round(capture.platform_fee_cents) + pe.service_fee_cents;

  const engineParts = assembleComparableQuoteFromParts({
    service: "marketplace",
    currency: capture.currency,
    baseCents: pe.subtotal_cents,
    taxCents: 0,
    feeCents: pe.delivery_fee_cents + pe.service_fee_cents,
    promotionCents: 0,
    customerTotalCents: pe.total_cents,
    driverEarningsCents: driver,
    restaurantEarningsCents: null,
    sellerEarningsCents: seller,
    platformRevenueCents: enginePlatform,
    legacyVersion: "legacy-marketplace-shadow-v2",
    meta: {
      side: "engine",
      sot: "pricing-engine",
      pe_delivery_fee_cents: pe.delivery_fee_cents,
      pe_total_cents: pe.total_cents,
      delivery_formula_diff_cents: pe.delivery_fee_cents - delivery,
      delivery_from_formula: pe.delivery_from_formula,
    },
  });
  if (!engineParts.ok) throw new Error(engineParts.reason);

  return { legacy: legacyParts.quote, engine: engineParts.quote };
}
