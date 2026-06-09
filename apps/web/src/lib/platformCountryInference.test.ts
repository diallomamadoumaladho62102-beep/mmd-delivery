import assert from "node:assert/strict";
import {
  detectPlatformCountryFromCoordinates,
  inferPlatformCountryCode,
  normalizeStripeConnectCountry,
  pricingConfigKeyForOrder,
} from "./platformCountryInference";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("inferPlatformCountryCode prefers coordinates over XOF currency", () => {
  assert.equal(
    inferPlatformCountryCode({ currency: "XOF", lat: 5.36, lng: -4.01 }),
    "CI"
  );
  assert.equal(
    inferPlatformCountryCode({ currency: "XOF", lat: 16.0, lng: -3.0 }),
    "ML"
  );
});

test("detectPlatformCountryFromCoordinates resolves Guinea", () => {
  assert.equal(detectPlatformCountryFromCoordinates(9.55, -13.67), "GN");
});

test("pricingConfigKeyForOrder uses africa keys from coordinates", () => {
  assert.equal(
    pricingConfigKeyForOrder({
      orderType: "food",
      currency: "USD",
      lat: 9.55,
      lng: -13.67,
    }),
    "food_africa"
  );
});

test("normalizeStripeConnectCountry maps country names", () => {
  assert.equal(normalizeStripeConnectCountry("Senegal"), "SN");
  assert.equal(normalizeStripeConnectCountry("FR"), "FR");
});

console.log("platformCountryInference tests passed");
