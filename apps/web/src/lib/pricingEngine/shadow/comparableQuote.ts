/**
 * Normalized quote breakdown for Legacy vs Engine shadow compare (Phase 2).
 * Amounts in integer cents. Null = not applicable / not available on this path.
 */

export type PricingServiceKind = "food" | "package" | "ride" | "marketplace";

export type ComparableQuote = {
  service: PricingServiceKind;
  currency: string;
  customerTotalCents: number;
  baseCents: number;
  taxCents: number;
  feeCents: number;
  promotionCents: number;
  /** Driver / courier earnings (cents); null if N/A */
  driverEarningsCents: number | null;
  restaurantEarningsCents: number | null;
  sellerEarningsCents: number | null;
  platformRevenueCents: number | null;
  legacyVersion: string;
  engineVersion: string;
  meta?: Record<string, unknown>;
};

export type QuoteFieldDiff = {
  field: keyof ComparableQuote | string;
  legacy: number | string | null;
  engine: number | string | null;
  diffCents?: number;
  engineName?: string;
  ruleHint?: string;
  proposedFix?: string;
};

export type ShadowCompareReport = {
  equal: boolean;
  service: PricingServiceKind;
  currency: string;
  diffCents: number;
  fieldDiffs: QuoteFieldDiff[];
  legacyLatencyMs: number;
  engineLatencyMs: number;
  legacy: ComparableQuote;
  engine: ComparableQuote;
  at: string;
  compareId: string;
};
