import assert from "node:assert/strict";
import {
  assertPlatformFeatureFromConfig,
  inferPlatformCountryCode,
  normalizePlatformCountryCode,
  type PlatformCountryConfig,
} from "./platformLaunchControl";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function baseConfig(overrides: Partial<PlatformCountryConfig> = {}): PlatformCountryConfig {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    country_code: "GN",
    country_name: "Guinea",
    continent: "Africa",
    region: "West Africa",
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    checkout_enabled: true,
    payout_enabled: true,
    maintenance_mode: false,
    launch_status: "enabled",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("normalizePlatformCountryCode trims and uppercases", () => {
  assert.equal(normalizePlatformCountryCode(" gn "), "GN");
});

test("inferPlatformCountryCode prefers explicit country", () => {
  assert.equal(inferPlatformCountryCode({ countryCode: "CI", currency: "USD" }), "CI");
});

test("inferPlatformCountryCode maps currency fallback", () => {
  assert.equal(inferPlatformCountryCode({ currency: "gnf" }), "GN");
  assert.equal(inferPlatformCountryCode({ currency: "xof" }), "SN");
  assert.equal(inferPlatformCountryCode({ currency: "usd" }), "US");
});

test("platform disabled blocks all verticals", () => {
  const result = assertPlatformFeatureFromConfig(
    baseConfig({ platform_enabled: false }),
    "taxi",
    "active"
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "platform_disabled");
});

test("maintenance blocks taxi checkout", () => {
  const result = assertPlatformFeatureFromConfig(
    baseConfig({ maintenance_mode: true }),
    "taxi",
    "checkout"
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "platform_maintenance");
});

test("taxi checkout requires taxi_enabled and checkout_enabled", () => {
  assert.equal(
    assertPlatformFeatureFromConfig(baseConfig({ taxi_enabled: false }), "taxi", "checkout").ok,
    false
  );
  assert.equal(
    assertPlatformFeatureFromConfig(baseConfig({ checkout_enabled: false }), "taxi", "checkout").ok,
    false
  );
  assert.equal(assertPlatformFeatureFromConfig(baseConfig(), "taxi", "checkout").ok, true);
});

test("delivery and restaurant vertical guards", () => {
  assert.equal(
    assertPlatformFeatureFromConfig(baseConfig({ delivery_enabled: false }), "delivery", "active")
      .ok,
    false
  );
  assert.equal(
    assertPlatformFeatureFromConfig(
      baseConfig({ restaurant_enabled: false }),
      "restaurant",
      "active"
    ).ok,
    false
  );
  assert.equal(assertPlatformFeatureFromConfig(baseConfig(), "delivery", "checkout").ok, true);
  assert.equal(
    assertPlatformFeatureFromConfig(baseConfig({ payout_enabled: false }), "taxi", "payout").ok,
    false
  );
});

console.log("platformLaunchControl tests passed");
