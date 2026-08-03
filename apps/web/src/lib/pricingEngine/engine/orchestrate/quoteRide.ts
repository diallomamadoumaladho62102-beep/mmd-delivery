/**
 * Phase 5F — Ride final price SoT via Pricing Engine.
 * Taxi base fare remains via rate port (RPC quote_taxi_ride); PE owns final net.
 */
import { computeTaxiFinalPrice } from "../compute/taxiFinalPrice";
import { PE_QUOTE_ENGINE_VERSION, type PeChargeMeta } from "./types";

export type RidePeFinalQuote = {
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
  pe: PeChargeMeta;
};

export function quoteRideFinalWithPricingEngine(input: {
  subtotal_cents: number;
  tax_cents: number;
  gross_total_cents?: number;
  promo_discount_cents?: number;
  loyalty_discount_cents?: number;
  shared_discount_cents?: number;
  mmd_credit_cents?: number;
  mmd_plus_discount_cents?: number;
  shared_ride?: boolean;
}): RidePeFinalQuote {
  const snap = computeTaxiFinalPrice(input);
  return {
    ...snap,
    pe: {
      chargePath: "engine",
      engineVersion: PE_QUOTE_ENGINE_VERSION,
      failOpen: false,
      source: "pricing_engine_sot",
    },
  };
}

/** Build PE final quote from taxi RPC / ride row capture (rate port output). */
export function quoteRideFinalFromRateCapture(
  quote: Record<string, unknown>,
  options?: { shared_ride?: boolean }
): RidePeFinalQuote {
  const subtotal = Math.max(0, Math.round(Number(quote.subtotal_cents ?? 0)));
  const tax = Math.max(0, Math.round(Number(quote.tax_cents ?? 0)));
  const gross = Math.max(
    0,
    Math.round(Number(quote.gross_total_cents ?? subtotal + tax))
  );
  return quoteRideFinalWithPricingEngine({
    subtotal_cents: subtotal,
    tax_cents: tax,
    gross_total_cents: gross,
    promo_discount_cents: Math.max(
      0,
      Math.round(Number(quote.promo_discount_cents ?? 0))
    ),
    loyalty_discount_cents: Math.max(
      0,
      Math.round(Number(quote.loyalty_discount_cents ?? 0))
    ),
    shared_discount_cents:
      quote.shared_discount_cents != null
        ? Math.max(0, Math.round(Number(quote.shared_discount_cents)))
        : undefined,
    mmd_credit_cents: Math.max(0, Math.round(Number(quote.mmd_credit_cents ?? 0))),
    mmd_plus_discount_cents: Math.max(
      0,
      Math.round(Number(quote.mmd_plus_discount_cents ?? 0))
    ),
    shared_ride: options?.shared_ride === true,
  });
}
