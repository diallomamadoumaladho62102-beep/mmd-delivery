import { asMarketCountry, type MarketCountry } from "./selectedMarket";

export type GuestPlatformFeatures = {
  ok: false;
  error: "not_authenticated";
  country_code?: MarketCountry;
  scope_level?: "country";
  scope_source?: "selected_market";
  checkout_enabled: false;
  payout_enabled: false;
  seller_available: false;
  marketplace_available: false;
  platform_enabled: false;
  maintenance_mode: false;
  taxi_available: false;
  delivery_available: false;
  restaurant_available: false;
  can_go_online: false;
  can_accept_orders: false;
  ai_assistant_available: false;
  coming_soon_services: string[];
  message: null;
  refresh_after_ms: number;
  scope?: {
    country_code: MarketCountry;
    region_code: null;
    state_code: null;
    county_code: null;
    mmd_zone_id: null;
    zone_code: null;
    scope_level: "country";
    scope_source: "selected_market";
  };
};

function signedOutBase(): GuestPlatformFeatures {
  return {
    ok: false,
    error: "not_authenticated",
    platform_enabled: false,
    maintenance_mode: false,
    taxi_available: false,
    delivery_available: false,
    restaurant_available: false,
    marketplace_available: false,
    seller_available: false,
    checkout_enabled: false,
    payout_enabled: false,
    can_go_online: false,
    can_accept_orders: false,
    ai_assistant_available: false,
    coming_soon_services: ["marketplace", "seller"],
    message: null,
    refresh_after_ms: 60_000,
  };
}

/**
 * Signed-out catalog scope. A stored market is a country choice, not a GPS fix
 * and not an authenticated platform entitlement.
 * Checkout, payouts and seller tools stay off. Approval rules stay on the server.
 */
export function resolveSignedOutPlatformFeatures(
  selectedMarket: string | null
): GuestPlatformFeatures {
  const country = asMarketCountry(selectedMarket);
  const base = signedOutBase();
  if (!country) return base;
  return {
    ...base,
    country_code: country,
    scope_level: "country",
    scope_source: "selected_market",
    scope: {
      country_code: country,
      region_code: null,
      state_code: null,
      county_code: null,
      mmd_zone_id: null,
      zone_code: null,
      scope_level: "country",
      scope_source: "selected_market",
    },
  };
}

export function signedOutMarketCountry(
  features: {
    error?: string;
    country_code?: string;
    scope_source?: string;
    scope?: { country_code?: string; scope_source?: string };
  } | null | undefined
): MarketCountry | null {
  if (features?.error !== "not_authenticated") return null;
  if (
    features.scope_source !== "selected_market" &&
    features.scope?.scope_source !== "selected_market"
  ) {
    return null;
  }
  return asMarketCountry(features.country_code ?? features.scope?.country_code);
}
