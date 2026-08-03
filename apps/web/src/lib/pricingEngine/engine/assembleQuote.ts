import type {
  ComparableQuote,
  PricingServiceKind,
} from "../contracts/comparableQuote";
import { PRICING_ENGINE_MIGRATION_PHASE } from "../phaseGate";

export const PRICING_ENGINE_ALGORITHM_SEMVER = "6.0.0";

/**
 * Assemble a ComparableQuote from captured line amounts (no Mapbox/Stripe).
 * Used for optional Quote Snapshot persistence — not dual-path compare.
 */
export function assembleComparableQuoteFromParts(input: {
  service: PricingServiceKind;
  currency: string;
  baseCents: number;
  taxCents: number;
  feeCents: number;
  promotionCents: number;
  customerTotalCents: number;
  driverEarningsCents: number | null;
  restaurantEarningsCents: number | null;
  sellerEarningsCents: number | null;
  platformRevenueCents: number | null;
  legacyVersion: string;
  meta?: Record<string, unknown>;
}): { ok: true; quote: ComparableQuote } | { ok: false; reason: string } {
  const expected =
    input.baseCents +
    input.taxCents +
    input.feeCents -
    input.promotionCents;

  if (!Number.isFinite(input.customerTotalCents)) {
    return { ok: false, reason: "invalid_customer_total" };
  }

  const quote: ComparableQuote = {
    service: input.service,
    currency: String(input.currency || "USD").toUpperCase(),
    customerTotalCents: Math.round(input.customerTotalCents),
    baseCents: Math.round(input.baseCents),
    taxCents: Math.round(input.taxCents),
    feeCents: Math.round(input.feeCents),
    promotionCents: Math.round(input.promotionCents),
    driverEarningsCents:
      input.driverEarningsCents == null
        ? null
        : Math.round(input.driverEarningsCents),
    restaurantEarningsCents:
      input.restaurantEarningsCents == null
        ? null
        : Math.round(input.restaurantEarningsCents),
    sellerEarningsCents:
      input.sellerEarningsCents == null
        ? null
        : Math.round(input.sellerEarningsCents),
    platformRevenueCents:
      input.platformRevenueCents == null
        ? null
        : Math.round(input.platformRevenueCents),
    legacyVersion: input.legacyVersion,
    engineVersion: `pricing-engine@${PRICING_ENGINE_ALGORITHM_SEMVER}+phase${PRICING_ENGINE_MIGRATION_PHASE}`,
    meta: {
      ...input.meta,
      pipeline: "rate>tax>fee>promo>policy>commission>validation",
      expected_identity_cents: expected,
    },
  };

  return { ok: true, quote };
}
