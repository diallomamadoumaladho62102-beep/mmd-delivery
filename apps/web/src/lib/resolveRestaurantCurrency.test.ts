import assert from "node:assert/strict";
import test from "node:test";
import {
  currencyFromOrderRows,
  resolveRestaurantCurrency,
} from "./resolveRestaurantCurrency";

test("currencyFromOrderRows returns first valid order currency", () => {
  assert.equal(
    currencyFromOrderRows([
      { currency: "" },
      { currency: "gnf" },
      { currency: "USD" },
    ]),
    "GNF"
  );
});

test("resolveRestaurantCurrency prefers order currency", () => {
  assert.equal(
    resolveRestaurantCurrency({
      profile: { location_lat: 40.7128, location_lng: -74.006 },
      orderRows: [{ currency: "EUR" }],
    }),
    "EUR"
  );
});

test("resolveRestaurantCurrency falls back to market country from coordinates", () => {
  assert.equal(
    resolveRestaurantCurrency({
      profile: { location_lat: 9.5, location_lng: -13.7 },
      orderRows: [],
    }),
    "GNF"
  );
});

test("resolveRestaurantCurrency defaults to USD when no orders or coords", () => {
  assert.equal(resolveRestaurantCurrency({ profile: {}, orderRows: [] }), "USD");
});
