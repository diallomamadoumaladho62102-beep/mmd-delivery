/**
 * Marketplace checkout types + feature flag.
 * Totals SoT: pricingEngine quoteMarketplaceWithPricingEngine / quoteMarketplaceSot.
 */

export type MarketplaceCheckoutItemInput = {
  price_cents: number;
  quantity: number;
};

export type MarketplaceCheckoutShadow = {
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
  total_cents: number;
  checkout_enabled: boolean;
  pricing_engine_version: "marketplace_checkout_shadow_v2";
  message: string | null;
};

export function isMarketplaceCheckoutEnabled(): boolean {
  return process.env.MARKETPLACE_CHECKOUT_ENABLED === "true";
}

export const MARKETPLACE_CHECKOUT_COMING_SOON =
  "Marketplace checkout coming soon";
