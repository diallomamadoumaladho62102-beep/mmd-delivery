/**
 * Phase 6 — SoT entrypoints (PE only). Kill Switch / legacy bridge removed.
 */
export {
  quoteFoodWithPricingEngine as quoteFoodSot,
  type FoodPeQuote,
  type QuoteFoodInput,
} from "./quoteFood";
export {
  quotePackageWithPricingEngine as quotePackageSot,
  type PackagePeQuote,
  type QuotePackageInput,
} from "./quotePackage";
export {
  quoteMarketplaceWithPricingEngine as quoteMarketplaceSot,
  type MarketplacePeQuote,
  type MarketplaceQuoteItemInput,
} from "./quoteMarketplace";
export {
  quoteRideFinalWithPricingEngine as quoteRideFinalSot,
  quoteRideFinalFromRateCapture as quoteRideFinalFromRateCaptureSot,
  type RidePeFinalQuote,
} from "./quoteRide";
