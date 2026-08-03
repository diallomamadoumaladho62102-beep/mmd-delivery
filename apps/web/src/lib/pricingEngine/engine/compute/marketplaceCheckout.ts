/**
 * Phase 5B — PE-owned Marketplace checkout fee/total assembly.
 * Formula mirrored from legacy computeMarketplaceCheckoutShadow (pure parts).
 */
import { getPricingBusinessDefaults } from "../../config/businessDefaults";
import { roundCents } from "./money";

export function computeMarketplaceDeliveryFeeCents(subtotalCents: number): number {
  const d = getPricingBusinessDefaults();
  const sub = roundCents(subtotalCents);
  return roundCents(
    Math.max(
      d.marketplace_delivery_fee_floor_cents,
      sub * d.marketplace_delivery_fee_pct
    )
  );
}

export function computeMarketplaceCheckoutTotals(input: {
  subtotal_cents: number;
  service_fee_cents?: number;
  /** When set, used instead of the PE delivery formula (explicit override input). */
  delivery_fee_cents_override?: number | null;
}): {
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  delivery_from_formula: boolean;
} {
  const subtotal_cents = roundCents(input.subtotal_cents);
  const service_fee_cents = roundCents(input.service_fee_cents ?? 0);
  const hasOverride =
    input.delivery_fee_cents_override != null &&
    Number.isFinite(Number(input.delivery_fee_cents_override));
  const delivery_fee_cents = hasOverride
    ? roundCents(Number(input.delivery_fee_cents_override))
    : computeMarketplaceDeliveryFeeCents(subtotal_cents);
  return {
    subtotal_cents,
    delivery_fee_cents,
    service_fee_cents,
    total_cents: subtotal_cents + delivery_fee_cents + service_fee_cents,
    delivery_from_formula: !hasOverride,
  };
}
