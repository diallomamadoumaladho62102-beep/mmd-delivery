import assert from "node:assert/strict";
import {
  applyCountryFloor,
  buildFeatureAvailability,
  countryConfigToToggleConfig,
  normalizeUsStateCode,
  regionRowToToggleConfig,
} from "./platformScopeResolver";
import type { PlatformCountryConfig } from "./platformLaunchControl";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function baseCountry(overrides: Partial<PlatformCountryConfig & { marketplace_enabled?: boolean; seller_enabled?: boolean }> = {}) {
  return countryConfigToToggleConfig({
    id: "1",
    country_code: "US",
    country_name: "United States",
    continent: "North America",
    region: null,
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    checkout_enabled: true,
    payout_enabled: true,
    maintenance_mode: false,
    launch_status: "enabled",
    created_at: "",
    updated_at: "",
    marketplace_enabled: false,
    seller_enabled: false,
    ...overrides,
  });
}

test("normalizeUsStateCode accepts NY and New York", () => {
  assert.equal(normalizeUsStateCode("ny"), "NY");
  assert.equal(normalizeUsStateCode("New York"), "NY");
});

test("country floor disables region when country OFF", () => {
  const country = baseCountry({ platform_enabled: false });
  const region = regionRowToToggleConfig({
    id: "r1",
    country_code: "US",
    region_code: "ny",
    region_name: "New York",
    region_type: "state",
    mmd_zone_id: null,
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: false,
    seller_enabled: false,
    checkout_enabled: true,
    payout_enabled: true,
    maintenance_mode: false,
    launch_status: "enabled",
  });

  const effective = applyCountryFloor(country, region, true);
  assert.equal(effective.platform_enabled, false);
  assert.equal(effective.taxi_enabled, false);
});

test("region override replaces country toggles when allowed", () => {
  const country = baseCountry({ taxi_enabled: true });
  const region = regionRowToToggleConfig({
    id: "r1",
    country_code: "US",
    region_code: "nj",
    region_name: "New Jersey",
    region_type: "state",
    mmd_zone_id: null,
    platform_enabled: true,
    taxi_enabled: false,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: false,
    seller_enabled: false,
    checkout_enabled: true,
    payout_enabled: true,
    maintenance_mode: false,
    launch_status: "enabled",
  });

  const effective = applyCountryFloor(country, region, true);
  assert.equal(effective.taxi_enabled, false);
  assert.equal(effective.delivery_enabled, true);
});

test("buildFeatureAvailability exposes coming soon marketplace", () => {
  const config = baseCountry();
  const scope = {
    country_code: "US",
    region_code: null,
    state_code: null,
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "country" as const,
    scope_source: "saved_address" as const,
  };
  const features = buildFeatureAvailability(config, scope);
  assert.equal(features.taxi_available, true);
  assert.deepEqual(features.coming_soon_services, ["marketplace", "seller"]);
});

test("marketplace_available follows marketplace_enabled when platform ON", () => {
  const config = baseCountry({ marketplace_enabled: true, seller_enabled: true });
  const scope = {
    country_code: "US",
    region_code: null,
    state_code: null,
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "country" as const,
    scope_source: "saved_address" as const,
  };
  const features = buildFeatureAvailability(config, scope);
  assert.equal(features.marketplace_available, true);
  assert.equal(features.seller_available, true);
  assert.deepEqual(features.coming_soon_services, []);
});

console.log("platformScopeResolver tests passed");
