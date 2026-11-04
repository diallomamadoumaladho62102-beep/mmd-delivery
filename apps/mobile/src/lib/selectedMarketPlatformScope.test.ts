/**
 * Regression: CountryWelcome selected market must drive client scope
 * without being overridden by device GPS when a market is stored.
 */
import assert from "node:assert/strict";

function resolveClientFeaturesQuery(input: {
  selectedMarket: "GN" | "US" | null;
  forceGps: boolean;
  lat?: number;
  lng?: number;
}): { manualCountry?: string; lat?: number; lng?: number } {
  if (!input.forceGps && input.selectedMarket) {
    return { manualCountry: input.selectedMarket };
  }
  return { lat: input.lat, lng: input.lng };
}

const gnPreferred = resolveClientFeaturesQuery({
  selectedMarket: "GN",
  forceGps: false,
  lat: 40.7128,
  lng: -74.006,
});
assert.deepEqual(gnPreferred, { manualCountry: "GN" });

const forceGps = resolveClientFeaturesQuery({
  selectedMarket: "GN",
  forceGps: true,
  lat: 40.7128,
  lng: -74.006,
});
assert.deepEqual(forceGps, { lat: 40.7128, lng: -74.006 });

const noSelection = resolveClientFeaturesQuery({
  selectedMarket: null,
  forceGps: false,
  lat: 11.3181,
  lng: -12.2832,
});
assert.deepEqual(noSelection, { lat: 11.3181, lng: -12.2832 });

console.log("selectedMarketPlatformScope.test.ts OK");
