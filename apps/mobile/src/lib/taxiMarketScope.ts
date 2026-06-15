import type { PlatformFeaturesResponse } from "./platformFeaturesApi";
import {
  currencyForMarketCountry,
  isDevCountryPickerEnabled,
  resolveMarketScopeFromFeatures,
  type UnifiedMarketScope,
} from "./marketScope";

export type TaxiMarketScope = Pick<
  UnifiedMarketScope,
  | "countryCode"
  | "stateCode"
  | "currencyCode"
  | "displayLabel"
  | "scopeResolved"
> & {
  taxiAvailable: boolean;
};

export function currencyForTaxiCountry(countryCode: string): string {
  return currencyForMarketCountry(countryCode);
}

export function resolveTaxiMarketFromFeatures(
  features: PlatformFeaturesResponse
): TaxiMarketScope {
  const market = resolveMarketScopeFromFeatures(features);
  return {
    countryCode: market.countryCode,
    stateCode: market.stateCode,
    currencyCode: market.currencyCode,
    displayLabel: market.displayLabel,
    taxiAvailable: market.taxiAvailable,
    scopeResolved: market.scopeResolved,
  };
}

export function isTaxiDevCountryPickerEnabled(): boolean {
  return isDevCountryPickerEnabled();
}
