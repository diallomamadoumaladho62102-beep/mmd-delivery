import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function read(relativeFromWeb: string): string {
  return readFileSync(join(process.cwd(), relativeFromWeb), "utf8");
}

test("taxi API entrypoints enforce taxi service distance limit", () => {
  const files = [
    "app/api/taxi/rides/quote/route.ts",
    "app/api/taxi/rides/create/route.ts",
    "app/api/taxi/scheduled/route.ts",
    "app/api/stripe/client/create-taxi-quote-checkout-session/route.ts",
  ];
  for (const file of files) {
    const src = read(file);
    assert.match(src, /validateRouteClaimsServer\(\{/);
    assert.match(src, /service:\s*"taxi"/);
    assert.match(src, /taxi_distance_too_far/);
  }
});

test("delivery quote/create/checkout return delivery distance guard", () => {
  const quote = read("app/api/delivery-requests/quote/route.ts");
  const create = read("app/api/delivery-requests/create/route.ts");
  const deliveryCheckout = read(
    "app/api/stripe/client/create-delivery-quote-checkout-session/route.ts",
  );
  const foodCheckout = read(
    "app/api/stripe/client/create-food-quote-checkout-session/route.ts",
  );

  assert.match(quote, /delivery_distance_too_far/);
  assert.match(create, /delivery_distance_too_far/);
  assert.match(deliveryCheckout, /delivery_distance_too_far/);
  assert.match(foodCheckout, /delivery_distance_too_far/);
});

test("delivery pricing orchestrators enforce service-specific limit", () => {
  const quoteFood = read("src/lib/pricingEngine/engine/orchestrate/quoteFood.ts");
  const quotePackage = read("src/lib/pricingEngine/engine/orchestrate/quotePackage.ts");
  const mapboxDistance = read("app/api/mapbox/compute-distance/route.ts");

  assert.match(quoteFood, /service:\s*"delivery"/);
  assert.match(quotePackage, /service:\s*"delivery"/);
  assert.match(mapboxDistance, /evaluateRouteDistanceLimit\(distanceMiles,\s*"delivery"\)/);
});

console.log("apiRouteDistanceGuards regression passed");
