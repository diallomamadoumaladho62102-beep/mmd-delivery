/**
 * Phase 5F — Marketplace checkout totals SoT via Pricing Engine.
 */
import type { PeServiceFeeConfig } from "../compute/serviceFee";
import { computePeClientServiceFeeFromCentsBase } from "../compute/serviceFee";
import {
  computeMarketplaceCheckoutTotals,
  computeMarketplaceDeliveryFeeCents,
} from "../compute/marketplaceCheckout";
import { PE_QUOTE_ENGINE_VERSION, type PeChargeMeta } from "./types";

export type MarketplaceQuoteItemInput = {
  price_cents: number;
  quantity: number;
};

export type MarketplacePeQuote = {
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
  total_cents: number;
  checkout_enabled: boolean;
  /** Compat with MarketplaceCheckoutShadow literal + PE version string. */
  pricing_engine_version: "marketplace_checkout_shadow_v2";
  message: string | null;
  pe: PeChargeMeta;
};

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function isMarketplaceCheckoutEnabledPe(): boolean {
  return process.env.MARKETPLACE_CHECKOUT_ENABLED === "true";
}

export function quoteMarketplaceWithPricingEngine(
  items: MarketplaceQuoteItemInput[],
  options?: {
    deliveryFeeCents?: number;
    serviceFeeConfig?: PeServiceFeeConfig | null;
  }
): MarketplacePeQuote {
  const subtotalCents = roundCents(
    items.reduce(
      (sum, item) =>
        sum + roundCents(item.price_cents) * Math.max(1, Math.round(item.quantity)),
      0
    )
  );

  const serviceFeeConfig: PeServiceFeeConfig = options?.serviceFeeConfig ?? {
    enabled: false,
    pct: 0,
    fixedCents: 0,
  };
  const serviceFeeResult = computePeClientServiceFeeFromCentsBase(
    serviceFeeConfig,
    subtotalCents
  );

  const deliveryFeeCents =
    options?.deliveryFeeCents != null
      ? roundCents(options.deliveryFeeCents)
      : computeMarketplaceDeliveryFeeCents(subtotalCents);

  const totals = computeMarketplaceCheckoutTotals({
    subtotal_cents: subtotalCents,
    service_fee_cents: serviceFeeResult.serviceFeeCents,
    delivery_fee_cents_override: deliveryFeeCents,
  });

  const checkoutEnabled = isMarketplaceCheckoutEnabledPe();

  return {
    subtotal_cents: totals.subtotal_cents,
    delivery_fee_cents: totals.delivery_fee_cents,
    service_fee_cents: serviceFeeResult.serviceFeeCents,
    service_fee_pct: serviceFeeResult.pct,
    service_fee_enabled: serviceFeeResult.enabled,
    service_fee_fixed_cents: serviceFeeResult.fixedCents,
    total_cents: totals.total_cents,
    checkout_enabled: checkoutEnabled,
    pricing_engine_version: "marketplace_checkout_shadow_v2",
    message: checkoutEnabled ? null : "Marketplace checkout coming soon",
    pe: {
      chargePath: "engine",
      engineVersion: PE_QUOTE_ENGINE_VERSION,
      failOpen: false,
      source: "pricing_engine_sot",
    },
  };
}
