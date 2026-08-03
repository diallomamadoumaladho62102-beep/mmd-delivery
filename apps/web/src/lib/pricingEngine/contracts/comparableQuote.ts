/**
 * Normalized quote breakdown (cents). Retained for Quote Snapshot persistence.
 * Phase 6: Shadow Compare removed — type is PE snapshot payload only.
 */

export type PricingServiceKind = "food" | "package" | "ride" | "marketplace";

/** Historical rows may still say "legacy"; new writes are "engine" only. */
export type ChargePath = "legacy" | "engine";

export type ComparableQuote = {
  service: PricingServiceKind;
  currency: string;
  customerTotalCents: number;
  baseCents: number;
  taxCents: number;
  feeCents: number;
  promotionCents: number;
  driverEarningsCents: number | null;
  restaurantEarningsCents: number | null;
  sellerEarningsCents: number | null;
  platformRevenueCents: number | null;
  legacyVersion: string;
  engineVersion: string;
  meta?: Record<string, unknown>;
};
