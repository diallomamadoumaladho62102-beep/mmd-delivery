import assert from "node:assert/strict";
import {
  applyMarketplaceCoordsToOrder,
  coordsFromLocationJoin,
  countryCodeFromMarketplaceNavRow,
  marketplaceDriverPayoutDollars,
} from "./marketplaceDriverNavigation";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("coordsFromLocationJoin reads pin_lat/pin_lng", () => {
  const point = coordsFromLocationJoin({ pin_lat: 9.641, pin_lng: -13.578 });
  assert.equal(point?.latitude, 9.641);
  assert.equal(point?.longitude, -13.578);
});

test("applyMarketplaceCoordsToOrder fills order coords", () => {
  const order = {
    pickup_lat: null,
    pickup_lng: null,
    dropoff_lat: null,
    dropoff_lng: null,
  };
  const enriched = applyMarketplaceCoordsToOrder(order, {
    pickup: { pin_lat: 9.1, pin_lng: -13.1 },
    dropoff: { pin_lat: 9.2, pin_lng: -13.2 },
  });
  assert.equal(enriched.pickup_lat, 9.1);
  assert.equal(enriched.dropoff_lng, -13.2);
});

test("countryCodeFromMarketplaceNavRow prefers seller country", () => {
  assert.equal(
    countryCodeFromMarketplaceNavRow({
      sellers: { country_code: "GN" },
      pickup: { country_code: "US" },
    }),
    "GN"
  );
});

test("marketplaceDriverPayoutDollars converts cents", () => {
  assert.equal(marketplaceDriverPayoutDollars({ driver_earning_cents: 850 }), 8.5);
});

console.log("marketplaceDriverNavigation tests passed");
