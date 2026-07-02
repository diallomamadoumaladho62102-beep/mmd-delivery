import type { ServiceFeeConfig } from "@/lib/clientServiceFee";
import {
  computeClientServiceFeeFromCentsBase,
} from "@/lib/clientServiceFee";

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

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

const DEFAULT_SHADOW_DELIVERY_FEE = (subtotalCents: number) =>
  roundCents(Math.max(299, subtotalCents * 0.08));

/**
 * Shadow checkout totals — respects admin service fee config when provided.
 */
export function computeMarketplaceCheckoutShadow(
  items: MarketplaceCheckoutItemInput[],
  options?: {
    deliveryFeeCents?: number;
    serviceFeeConfig?: ServiceFeeConfig | null;
  }
): MarketplaceCheckoutShadow {
  const subtotalCents = roundCents(
    items.reduce(
      (sum, item) =>
        sum + roundCents(item.price_cents) * Math.max(1, Math.round(item.quantity)),
      0
    )
  );

  const deliveryFeeCents =
    options?.deliveryFeeCents ?? DEFAULT_SHADOW_DELIVERY_FEE(subtotalCents);
  const serviceFeeConfig: ServiceFeeConfig = options?.serviceFeeConfig ?? {
    enabled: false,
    pct: 0,
    fixedCents: 0,
  };
  const serviceFeeResult = computeClientServiceFeeFromCentsBase(
    serviceFeeConfig,
    subtotalCents
  );
  const totalCents =
    subtotalCents + deliveryFeeCents + serviceFeeResult.serviceFeeCents;
  const checkoutEnabled = isMarketplaceCheckoutEnabled();

  return {
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    service_fee_cents: serviceFeeResult.serviceFeeCents,
    service_fee_pct: serviceFeeResult.pct,
    service_fee_enabled: serviceFeeResult.enabled,
    service_fee_fixed_cents: serviceFeeResult.fixedCents,
    total_cents: totalCents,
    checkout_enabled: checkoutEnabled,
    pricing_engine_version: "marketplace_checkout_shadow_v2",
    message: checkoutEnabled
      ? null
      : "Marketplace checkout coming soon",
  };
}

export const MARKETPLACE_CHECKOUT_COMING_SOON =
  "Marketplace checkout coming soon";
