import type { PlatformFeaturesResponse } from "./platformFeaturesApi";
import { getTaxiCountryLabel } from "./taxiLocalization";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
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

export type UnifiedMarketScope = {
  countryCode: string;
  stateCode: string | null;
  regionCode: string | null;
  currencyCode: string;
  displayLabel: string;
  scopeSource: string | null;
  scopeResolved: boolean;
  taxiAvailable: boolean;
  deliveryAvailable: boolean;
  restaurantAvailable: boolean;
  marketplaceAvailable: boolean;
  aiAssistantAvailable: boolean;
};

export function currencyForMarketCountry(countryCode: string): string {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return "USD";
  return CURRENCY_BY_COUNTRY[code] ?? "USD";
}

export function resolveMarketScopeFromFeatures(
  features: PlatformFeaturesResponse
): UnifiedMarketScope {
  let scopedFeatures = features;

  if (__DEV__) {
    const mockMarket = process.env.EXPO_PUBLIC_TAXI_MOCK_MARKET?.trim().toUpperCase();
    if (mockMarket === "GN" || mockMarket === "US") {
      scopedFeatures = {
        ...features,
        ok: true,
        country_code: mockMarket,
        state_code: mockMarket === "US" ? "NY" : null,
        scope_label: mockMarket === "US" ? "United States / New York" : "Guinea",
        scope_source: "gps",
        taxi_available: true,
        delivery_available: true,
        restaurant_available: true,
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
  const regionCode =
    scopedFeatures.region_code ?? scopedFeatures.scope?.region_code ?? null;
  const scopeLabel =
    scopedFeatures.scope_label ?? scopedFeatures.scope?.scope_label ?? null;
  const scopeSource =
    scopedFeatures.scope_source ?? scopedFeatures.scope?.scope_source ?? null;
  const countryName = countryCode ? getTaxiCountryLabel(countryCode) : "";

  let displayLabel = scopeLabel?.trim() ?? "";
  if (!displayLabel && countryCode) {
    displayLabel = stateCode ? `${countryName} / ${stateCode}` : countryName;
  }

  return {
    countryCode,
    stateCode,
    regionCode,
    currencyCode: currencyForMarketCountry(countryCode),
    displayLabel: displayLabel || countryName || countryCode || "",
    scopeSource,
    scopeResolved: Boolean(countryCode) && scopedFeatures.ok !== false,
    taxiAvailable: scopedFeatures.ok !== false && scopedFeatures.taxi_available !== false,
    deliveryAvailable:
      scopedFeatures.ok !== false && scopedFeatures.delivery_available !== false,
    restaurantAvailable:
      scopedFeatures.ok !== false && scopedFeatures.restaurant_available !== false,
    marketplaceAvailable:
      scopedFeatures.ok !== false && scopedFeatures.marketplace_available === true,
    aiAssistantAvailable:
      scopedFeatures.ok !== false && scopedFeatures.ai_assistant_available === true,
  };
}

export function isDevCountryPickerEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_TAXI_DEV_COUNTRY_PICKER === "1";
}

export function requireScopedCountryCode(market: UnifiedMarketScope): string {
  if (market.countryCode) return market.countryCode;
  throw new Error("market_scope_unresolved");
}

/** Infer ISO country from coordinates for restaurant/market filtering. */
export function inferCountryFromCoordinates(
  lat: number,
  lng: number
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat >= 7 && lat <= 13 && lng >= -16 && lng <= -7) return "GN";
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return "US";
  return null;
}

export function coordinatesMatchMarketCountry(
  lat: number,
  lng: number,
  marketCountryCode: string
): boolean {
  const market = String(marketCountryCode ?? "")
    .trim()
    .toUpperCase();
  if (!market) return false;
  const inferred = inferCountryFromCoordinates(lat, lng);
  return inferred === market;
}
