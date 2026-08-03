/**
 * MMD Pricing Engine — Phase 5B Independence
 *
 * Defaults: charge = legacy (service flags OFF, canary 0).
 * Engine adapters compute via pricingEngine/engine/compute/* (PE SoT).
 */

export {
  resolvePricingEngineFlags,
  resolveChargePath,
  type PricingEngineFlags,
  type PricingEngineService,
} from "./flags";

export {
  isKillSwitchActive,
  isShadowCompareAllowed,
  resolveChargePathForPhase,
  type ChargePath,
  type ChargePathOptions,
} from "./killSwitch";

export {
  PRICING_ENGINE_MIGRATION_PHASE,
  type PricingEngineMigrationPhase,
} from "./phaseGate";

export { canaryBucket, isInCanaryBucket } from "./canary";

export {
  PRICING_BUSINESS_DEFAULTS,
  getPricingBusinessDefaults,
  getPricingBusinessDefault,
  type PricingBusinessDefaultKey,
  type PricingBusinessDefaults,
} from "./config/businessDefaults";

export type * from "./contracts/types";
export type * from "./observability/types";
export type * from "./shadow/types";
export type * from "./cache/types";
export type * from "./shadow/comparableQuote";

export {
  PRICING_INVARIANT_IDS,
  type PricingInvariantId,
} from "./invariants";

export {
  noopPricingLogger,
  noopPricingMetrics,
  recordShadowCompare,
  compareLegacyVsEngine,
} from "./observability/shadowObserve";

export { defaultShadowComparer } from "./shadow/types";
export { createMemoryPricingConfigCache } from "./cache/types";

export {
  runPricingShadowCompare,
  schedulePricingShadowCompare,
} from "./shadow/runShadowCompare";
export { compareComparableQuotes } from "./shadow/compareQuotes";
export {
  getShadowMetricsSnapshot,
  formatShadowMetricsReport,
  resetShadowMetricsForTests,
  averageLatencyMs,
} from "./shadow/metrics";
export {
  appendShadowJournal,
  getShadowJournalEntries,
  clearShadowJournalForTests,
  summarizeShadowJournal,
} from "./shadow/journal";
export { buildFoodComparablePair } from "./engine/adapters/foodAdapter";
export { buildPackageComparablePair } from "./engine/adapters/packageAdapter";
export { buildRideComparablePair } from "./engine/adapters/rideAdapter";
export { buildMarketplaceComparablePair } from "./engine/adapters/marketplaceAdapter";
export { computeDeliveryFeeV1, splitDeliveryFeeV1 } from "./engine/compute/deliveryFeeV1";
export { computeTaxiFinalPrice } from "./engine/compute/taxiFinalPrice";
export {
  computeMarketplaceDeliveryFeeCents,
  computeMarketplaceCheckoutTotals,
} from "./engine/compute/marketplaceCheckout";
export { runPhase2ParityHarness } from "./phase2ParityHarness";
export {
  selectFoodChargePath,
  selectPackageChargePath,
} from "./charge/selectFoodPackageCharge";
export { selectRideChargePath } from "./charge/selectRideChargePath";
export { selectMarketplaceChargePath } from "./charge/selectMarketplaceChargePath";
export {
  getCutoverMetricsSnapshot,
  resetCutoverMetricsForTests,
  recordCutoverSelection,
} from "./cutoverMetrics";
export {
  buildFoodPackageQuoteSnapshot,
  persistQuoteSnapshot,
  getRememberedQuoteSnapshots,
  clearRememberedQuoteSnapshotsForTests,
} from "./snapshot/foodPackageSnapshot";
