export type MarketplaceCheckoutItemInput = {
  price_cents: number;
  quantity: number;
};

export type MarketplaceCheckoutShadow = {
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  checkout_enabled: boolean;
  pricing_engine_version: "marketplace_checkout_shadow_v1";
  message: string | null;
};

export function isMarketplaceCheckoutEnabled(): boolean {
  return process.env.MARKETPLACE_CHECKOUT_ENABLED === "true";
}

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * Shadow checkout totals only — no Stripe, no dispatch, no payouts.
 */
export function computeMarketplaceCheckoutShadow(
  items: MarketplaceCheckoutItemInput[],
  options?: {
    deliveryFeeCents?: number;
    serviceFeeCents?: number;
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
    options?.deliveryFeeCents ??
    roundCents(Math.max(299, subtotalCents * 0.08));
  const serviceFeeCents =
    options?.serviceFeeCents ??
    roundCents(Math.max(99, subtotalCents * 0.05));
  const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents;
  const checkoutEnabled = isMarketplaceCheckoutEnabled();

  return {
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    service_fee_cents: serviceFeeCents,
    total_cents: totalCents,
    checkout_enabled: checkoutEnabled,
    pricing_engine_version: "marketplace_checkout_shadow_v1",
    message: checkoutEnabled
      ? null
      : "Marketplace checkout coming soon",
  };
}

export const MARKETPLACE_CHECKOUT_COMING_SOON =
  "Marketplace checkout coming soon";
