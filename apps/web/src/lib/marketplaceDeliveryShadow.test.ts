import assert from "node:assert/strict";
import {
  computeMarketplaceDeliveryShadow,
  computeMarketplaceDispatchShadow,
  isMarketplaceDeliveryShadowEnabled,
} from "./marketplaceDeliveryShadow";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const originalFlag = process.env.MARKETPLACE_DELIVERY_SHADOW_ENABLED;

test("computeMarketplaceDeliveryShadow uses pricing V2 components", () => {
  const result = computeMarketplaceDeliveryShadow({
    pickupLat: 9.6378,
    pickupLng: -13.5784,
    dropoffLat: 9.6412,
    dropoffLng: -13.5718,
    sellerPickupAddress: "Seller shop, Conakry",
    pickupCountryCode: "GN",
    dropoffCountryCode: "GN",
    activeDriversInZone: 4,
  });

  assert.equal(result.delivery_status_shadow, "dispatch_simulated");
  assert.ok(result.estimated_distance_miles > 0);
  assert.ok(result.estimated_minutes > 0);
  assert.equal(
    result.delivery_quote_shadow.customer_delivery_total_cents,
    result.delivery_quote_shadow.driver_estimated_earning_cents +
      result.delivery_quote_shadow.platform_margin_cents
  );
  assert.equal(result.dispatch_shadow.live_dispatch_enabled, false);
  assert.equal(result.dispatch_shadow.drivers_notified, false);
});

test("computeMarketplaceDispatchShadow never enables live dispatch", () => {
  const dispatch = computeMarketplaceDispatchShadow({
    pickupZoneCode: "MATAM",
    dropoffZoneCode: "RATOMA",
    pickupCountryCode: "GN",
    dropoffCountryCode: "GN",
    activeDriversInZone: 0,
    estimatedDistanceMiles: 4.2,
  });

  assert.equal(dispatch.live_dispatch_enabled, false);
  assert.equal(dispatch.dispatch_readiness, "insufficient_drivers");
});

test("feature flag defaults to disabled", () => {
  delete process.env.MARKETPLACE_DELIVERY_SHADOW_ENABLED;
  assert.equal(isMarketplaceDeliveryShadowEnabled(), false);
});

process.env.MARKETPLACE_DELIVERY_SHADOW_ENABLED = originalFlag;

console.log("marketplaceDeliveryShadow tests passed");
