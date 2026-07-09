import assert from "node:assert/strict";
import {
  applyCountyFloor,
  buildFeatureAvailability,
  buildScopeLabel,
  countryConfigToToggleConfig,
  countyRowToToggleConfig,
  regionRowToToggleConfig,
} from "./platformScopeResolver";
import {
  detectUsCountyFromCoordinates,
  normalizeUsCountyCode,
} from "./platformCountyInference";
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

function baseCountry(
  overrides: Partial<
    PlatformCountryConfig & { marketplace_enabled?: boolean; seller_enabled?: boolean }
  > = {}
) {
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
    marketplace_enabled: true,
    seller_enabled: true,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
    ...overrides,
  });
}

function nyState(overrides: Partial<Parameters<typeof regionRowToToggleConfig>[0]> = {}) {
  return regionRowToToggleConfig({
    id: "r-ny",
    country_code: "US",
    region_code: "ny",
    region_name: "New York",
    region_type: "state",
    mmd_zone_id: null,
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: true,
    seller_enabled: true,
    checkout_enabled: true,
    payout_enabled: true,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
    maintenance_mode: false,
    launch_status: "enabled",
    ai_enabled: false,
    ...overrides,
  });
}

function nassauCounty(
  overrides: Partial<Parameters<typeof countyRowToToggleConfig>[0]> = {}
) {
  return countyRowToToggleConfig({
    id: "c-nassau",
    country_code: "US",
    region_code: "ny",
    county_code: "nassau",
    county_name: "Nassau County",
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: true,
    seller_enabled: true,
    checkout_enabled: true,
    payout_enabled: true,
    maintenance_mode: false,
    launch_status: "enabled",
    ...overrides,
  });
}

test("normalizeUsCountyCode accepts Nassau County and nassau", () => {
  assert.equal(normalizeUsCountyCode("nassau"), "nassau");
  assert.equal(normalizeUsCountyCode("Nassau County"), "nassau");
  assert.equal(normalizeUsCountyCode("New York City"), "nyc");
  assert.equal(normalizeUsCountyCode("Westchester"), "westchester");
});

test("detectUsCountyFromCoordinates resolves NYC and Nassau", () => {
  assert.equal(detectUsCountyFromCoordinates(40.7128, -74.006, "NY"), "nyc");
  assert.equal(detectUsCountyFromCoordinates(40.75, -73.55, "NY"), "nassau");
  assert.equal(detectUsCountyFromCoordinates(40.95, -73.75, "NY"), "westchester");
});

test("state OFF cascades — all county services OFF", () => {
  const country = baseCountry();
  const region = nyState({ platform_enabled: false });
  const county = nassauCounty({
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: true,
  });

  const effective = applyCountyFloor(country, region, county, true, true);
  assert.equal(effective.platform_enabled, false);
  assert.equal(effective.taxi_enabled, false);
  assert.equal(effective.delivery_enabled, false);
  assert.equal(effective.restaurant_enabled, false);
  assert.equal(effective.marketplace_enabled, false);
});

test("county OFF masks all services for client/driver/restaurant", () => {
  const country = baseCountry();
  const region = nyState();
  const county = nassauCounty({ platform_enabled: false });

  const effective = applyCountyFloor(country, region, county, true, true);
  const features = buildFeatureAvailability(effective, {
    country_code: "US",
    region_code: "ny",
    state_code: "NY",
    county_code: "nassau",
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "county",
    scope_source: "gps",
  });

  assert.equal(features.platform_enabled, false);
  assert.equal(features.taxi_available, false);
  assert.equal(features.delivery_available, false);
  assert.equal(features.restaurant_available, false);
  assert.equal(features.marketplace_available, false);
  assert.equal(features.can_go_online, false);
  assert.equal(features.can_accept_orders, false);
});

test("taxi OFF in county hides taxi only", () => {
  const country = baseCountry();
  const region = nyState();
  const county = nassauCounty({ taxi_enabled: false });

  const effective = applyCountyFloor(country, region, county, true, true);
  const features = buildFeatureAvailability(effective, {
    country_code: "US",
    region_code: "ny",
    state_code: "NY",
    county_code: "nassau",
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "county",
    scope_source: "manual",
  });

  assert.equal(features.taxi_available, false);
  assert.equal(features.delivery_available, true);
  assert.equal(features.restaurant_available, true);
  assert.equal(features.marketplace_available, true);
});

test("food OFF in county hides restaurant for clients and restaurants", () => {
  const country = baseCountry();
  const region = nyState();
  const county = nassauCounty({ restaurant_enabled: false });

  const effective = applyCountyFloor(country, region, county, true, true);
  const features = buildFeatureAvailability(effective, {
    country_code: "US",
    region_code: "ny",
    state_code: "NY",
    county_code: "nassau",
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "county",
    scope_source: "restaurant_address",
  });

  assert.equal(features.restaurant_available, false);
  assert.equal(features.can_accept_orders, false);
  assert.equal(features.taxi_available, true);
  assert.equal(features.delivery_available, true);
});

test("delivery OFF and marketplace OFF are masked independently", () => {
  const country = baseCountry();
  const region = nyState();
  const county = nassauCounty({
    delivery_enabled: false,
    marketplace_enabled: false,
  });

  const effective = applyCountyFloor(country, region, county, true, true);
  const features = buildFeatureAvailability(effective, {
    country_code: "US",
    region_code: "ny",
    state_code: "NY",
    county_code: "suffolk",
    mmd_zone_id: null,
    zone_code: null,
    scope_level: "county",
    scope_source: "gps",
  });

  assert.equal(features.delivery_available, false);
  assert.equal(features.marketplace_available, false);
  assert.equal(features.taxi_available, true);
  assert.equal(features.restaurant_available, true);
});

test("buildScopeLabel formats US county scope", () => {
  assert.equal(
    buildScopeLabel({
      country_code: "US",
      state_code: "NY",
      region_code: "ny",
      county_code: "nassau",
      zone_code: null,
    }),
    "US / NY / Nassau County"
  );
});

console.log("platformCountyScope tests passed");
