import type { PlatformFeaturesResponse } from "./platformFeaturesApi";
import { getTaxiCountryLabel } from "./taxiLocalization";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "USD",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
  ML: "XOF",
  SL: "SLE",
  MR: "MRU",
  FR: "EUR",
  BE: "EUR",
  GB: "GBP",
};

export type TaxiMarketScope = {
  countryCode: string;
  stateCode: string | null;
  currencyCode: string;
  displayLabel: string;
  taxiAvailable: boolean;
  scopeResolved: boolean;
};

export function currencyForTaxiCountry(countryCode: string): string {
  const code = String(countryCode ?? "US").toUpperCase();
  return CURRENCY_BY_COUNTRY[code] ?? "USD";
}

export function resolveTaxiMarketFromFeatures(
  features: PlatformFeaturesResponse
): TaxiMarketScope {
  let scopedFeatures = features;

  if (__DEV__) {
    const mockMarket = process.env.EXPO_PUBLIC_TAXI_MOCK_MARKET?.trim().toUpperCase();
    if (mockMarket === "GN" || mockMarket === "US") {
      scopedFeatures = {
        ...features,
        country_code: mockMarket,
        state_code: mockMarket === "US" ? "NY" : null,
        scope_label:
          mockMarket === "US" ? "United States / New York" : "Guinea",
        taxi_available: true,
      };
    }
  }

  const countryCode = String(
    scopedFeatures.country_code ?? scopedFeatures.scope?.country_code ?? ""
  )
    .trim()
    .toUpperCase();

  const stateCode =
    scopedFeatures.state_code ?? scopedFeatures.scope?.state_code ?? null;
  const scopeLabel =
    scopedFeatures.scope_label ?? scopedFeatures.scope?.scope_label ?? null;
  const countryName = countryCode
    ? getTaxiCountryLabel(countryCode)
    : "";

  let displayLabel = scopeLabel?.trim() ?? "";
  if (!displayLabel && countryCode) {
    displayLabel = stateCode
      ? `${countryName} / ${stateCode}`
      : countryName;
  }

  return {
    countryCode: countryCode || "US",
    stateCode,
    currencyCode: currencyForTaxiCountry(countryCode || "US"),
    displayLabel: displayLabel || countryName || countryCode || "US",
    taxiAvailable: scopedFeatures.taxi_available !== false,
    scopeResolved: Boolean(countryCode),
  };
}

export function isTaxiDevCountryPickerEnabled(): boolean {
  return (
    __DEV__ && process.env.EXPO_PUBLIC_TAXI_DEV_COUNTRY_PICKER === "1"
  );
}
