import assert from "node:assert/strict";
import { buildPlatformLaunchPatchUpdate } from "./adminPlatformLaunchPatch";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const existing = {
  platform_enabled: true,
  marketplace_enabled: true,
  seller_enabled: true,
  checkout_enabled: true,
  payout_enabled: true,
  maintenance_mode: false,
  launch_status: "enabled",
  marketplace_checkout_live_enabled: false,
  marketplace_dispatch_live_enabled: false,
  marketplace_payouts_live_enabled: false,
};

test("buildPlatformLaunchPatchUpdate enables marketplace visibility without live flags", () => {
  const result = buildPlatformLaunchPatchUpdate(existing, {
    marketplace_enabled: true,
    seller_enabled: true,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.marketplace_enabled, true);
    assert.equal(result.update.seller_enabled, true);
    assert.equal(result.update.marketplace_checkout_live_enabled, false);
    assert.equal(result.update.marketplace_payouts_live_enabled, false);
  }
});

test("buildPlatformLaunchPatchUpdate rejects invalid checkout live patch", () => {
  const result = buildPlatformLaunchPatchUpdate(
    { ...existing, checkout_enabled: false },
    { marketplace_checkout_live_enabled: true }
  );
  assert.equal(result.ok, false);
});

test("county patch persists taxi/delivery/restaurant/marketplace when county ON", () => {
  const result = buildPlatformLaunchPatchUpdate(
    {
      ...existing,
      platform_enabled: false,
      taxi_enabled: false,
      delivery_enabled: false,
      restaurant_enabled: false,
      marketplace_enabled: false,
      seller_enabled: false,
      launch_status: "disabled",
    },
    {
      platform_enabled: true,
      taxi_enabled: true,
      delivery_enabled: true,
      restaurant_enabled: true,
      marketplace_enabled: true,
      seller_enabled: false,
      checkout_enabled: true,
      payout_enabled: true,
      maintenance_mode: false,
      launch_status: "enabled",
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.platform_enabled, true);
    assert.equal(result.update.taxi_enabled, true);
    assert.equal(result.update.delivery_enabled, true);
    assert.equal(result.update.restaurant_enabled, true);
    assert.equal(result.update.marketplace_enabled, true);
    assert.notEqual(result.update.taxi_enabled, undefined);
  }
});

test("food_enabled alias maps to restaurant_enabled", () => {
  const result = buildPlatformLaunchPatchUpdate(existing, {
    platform_enabled: true,
    food_enabled: true,
    taxi_enabled: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.restaurant_enabled, true);
    assert.equal(result.update.taxi_enabled, false);
  }
});

test("county OFF forces all services OFF in update", () => {
  const result = buildPlatformLaunchPatchUpdate(
    {
      ...existing,
      taxi_enabled: true,
      delivery_enabled: true,
      restaurant_enabled: true,
    },
    {
      platform_enabled: false,
      taxi_enabled: true,
      delivery_enabled: true,
      restaurant_enabled: true,
      marketplace_enabled: true,
      launch_status: "disabled",
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.platform_enabled, false);
    assert.equal(result.update.taxi_enabled, false);
    assert.equal(result.update.delivery_enabled, false);
    assert.equal(result.update.restaurant_enabled, false);
    assert.equal(result.update.marketplace_enabled, false);
  }
});

console.log("adminPlatformLaunchPatch tests passed");
