/**
 * MMD Pricing Engine — Phase 6 (legacy dual-path removed).
 * Unique calculation engine for Ride / Food / Package / Marketplace.
 */

export {
  PRICING_ENGINE_MIGRATION_PHASE,
  type PricingEngineMigrationPhase,
} from "./phaseGate";

export {
  PRICING_BUSINESS_DEFAULTS,
  getPricingBusinessDefaults,
  getPricingBusinessDefault,
  type PricingBusinessDefaultKey,
  type PricingBusinessDefaults,
} from "./config/businessDefaults";

export type * from "./contracts/types";
export type * from "./contracts/comparableQuote";
export type * from "./cache/types";

export {
  PRICING_INVARIANT_IDS,
  type PricingInvariantId,
} from "./invariants";

export { createMemoryPricingConfigCache } from "./cache/types";

export { computeDeliveryFeeV1, splitDeliveryFeeV1 } from "./engine/compute/deliveryFeeV1";
export { computeTaxiFinalPrice } from "./engine/compute/taxiFinalPrice";
export {
  computeMarketplaceDeliveryFeeCents,
  computeMarketplaceCheckoutTotals,
} from "./engine/compute/marketplaceCheckout";

export {
  buildFoodPackageQuoteSnapshot,
  persistQuoteSnapshot,
  getRememberedQuoteSnapshots,
  clearRememberedQuoteSnapshotsForTests,
} from "./snapshot/foodPackageSnapshot";

export {
  quoteFoodSot,
  quotePackageSot,
  quoteMarketplaceSot,
  quoteRideFinalSot,
  quoteRideFinalFromRateCaptureSot,
} from "./engine/orchestrate/sot";
export { quoteFoodWithPricingEngine } from "./engine/orchestrate/quoteFood";
export { quotePackageWithPricingEngine } from "./engine/orchestrate/quotePackage";
export { quoteMarketplaceWithPricingEngine } from "./engine/orchestrate/quoteMarketplace";
export {
  quoteRideFinalWithPricingEngine,
  quoteRideFinalFromRateCapture,
} from "./engine/orchestrate/quoteRide";
export { PE_QUOTE_ENGINE_VERSION } from "./engine/orchestrate/types";
export {
  computePeClientServiceFee,
  computePeClientServiceFeeFromCentsBase,
  computePeServiceFeeBaseAmount,
  parsePeServiceFeeConfig,
} from "./engine/compute/serviceFee";
export { applyFoodTax, applyLegacyUsFoodTax } from "./engine/compute/foodTax";
export {
  applyOrderAndDeliveryDiscounts,
  sumDiscountDollars,
} from "./engine/compute/discountStack";
