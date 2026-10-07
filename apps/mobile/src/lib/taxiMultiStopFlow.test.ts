import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMultiStopQuoteNavigationParams,
  maxBookingStops,
  MAX_TAXI_STOPS,
  normalizeOrderedStops,
  reorderStops,
  shouldCreateRideBeforePayment,
} from "./taxiBookingFlow";

function testStopsOrderPreserved() {
  const stops = normalizeOrderedStops([
    "  Stop A  ",
    "",
    "Stop B",
    { address: "Stop C", lat: 1, lng: 2 },
  ]);
  assert.deepEqual(
    stops.map((s) => s.address),
    ["Stop A", "Stop B", "Stop C"]
  );
  assert.equal(stops[2].lat, 1);
  assert.equal(stops[2].lng, 2);
}

function testMaxStopsCapped() {
  const many = Array.from({ length: MAX_TAXI_STOPS + 3 }, (_, i) => `Stop ${i + 1}`);
  const stops = normalizeOrderedStops(many);
  assert.equal(stops.length, MAX_TAXI_STOPS);
}

function testReorderStops() {
  const stops = ["A", "B", "C", "D"];
  assert.deepEqual(reorderStops(stops, 0, 2), ["B", "C", "A", "D"]);
  assert.deepEqual(reorderStops(stops, 3, 1), ["A", "D", "B", "C"]);
  assert.deepEqual(reorderStops(stops, 1, 1), ["A", "B", "C", "D"]);
}

function testQuoteBeforeCreateInvariant() {
  assert.equal(shouldCreateRideBeforePayment(), false);
}

function testBuildNavParams() {
  const params = buildMultiStopQuoteNavigationParams({
    pickupAddress: "Pickup",
    dropoffAddress: "Dropoff",
    vehicleClass: "comfort",
    countryCode: "US",
    quote: { total_cents: 1000 },
    route: { distanceMiles: 3 },
    stops: ["Mid 1", "Mid 2"],
  });
  assert.equal(params.stops.length, 2);
  assert.equal(params.stops[0].address, "Mid 1");
  assert.equal(params.stops[1].address, "Mid 2");
  assert.equal(params.vehicleClass, "comfort");
  assert.notEqual(params.vehicleClass, "standard");
  assert.equal(shouldCreateRideBeforePayment(), false);
  assert.throws(
    () =>
      buildMultiStopQuoteNavigationParams({
        pickupAddress: "Pickup",
        dropoffAddress: "Dropoff",
        countryCode: "US",
        quote: {},
        stops: [],
      }),
    /vehicle_class_required/,
  );
}

function testCategoryMessagesAreOneLocaleEach() {
  const langs = ["en", "fr", "es", "ar", "zh", "ff"] as const;
  const categories = ["standard", "comfort", "xl", "wheelchair"] as const;
  const keys = [
    "categoryUnavailableNamed",
    "addStop",
    "removeStop",
    "roundTripStopLimit",
    "tooManyStops",
  ];
  const bundles = Object.fromEntries(
    langs.map((lang) => [
      lang,
      JSON.parse(
        readFileSync(join(process.cwd(), "src", "i18n", "locales", lang, "extras.json"), "utf8"),
      ).taxi.home as Record<string, string>,
    ]),
  );
  const seen = new Set<string>();
  for (const lang of langs) {
    for (const key of keys) {
      const value = bundles[lang][key];
      assert.equal(typeof value, "string", `${lang} ${key}`);
      assert.ok(value.trim().length > 0, `${lang} ${key}`);
      seen.add(`${lang}:${key}:${value}`);
    }
    for (const category of categories) {
      const label = bundles[lang][category];
      const message = bundles[lang].categoryUnavailableNamed.replace("{{category}}", label);
      assert.equal(message.includes("{{"), false);
      assert.ok(message.includes(label));
    }
  }
  const unavailable = langs.map((lang) => bundles[lang].categoryUnavailableNamed);
  assert.equal(new Set(unavailable).size, langs.length);
  assert.equal(seen.size, langs.length * keys.length);
}

function testCustomerTaxiSourcesDoNotHardcodeCategoryFallback() {
  const home = readFileSync(join(process.cwd(), "src", "screens", "taxi", "TaxiHomeScreen.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src", "lib", "taxiClientApi.ts"), "utf8");
  const multi = readFileSync(join(process.cwd(), "src", "screens", "taxi", "TaxiMultiStopScreen.tsx"), "utf8");
  assert.equal(home.includes("unavailable_message"), false);
  assert.equal(home.includes("Aucun chauffeur"), false);
  assert.equal(api.includes('vehicleClass: input.vehicleClass ?? "standard"'), false);
  assert.equal(multi.includes('vehicleClass: "standard"'), false);
  assert.equal(maxBookingStops("one_way"), 3);
  assert.equal(maxBookingStops("round_trip"), 2);
}

testStopsOrderPreserved();
testMaxStopsCapped();
testReorderStops();
testQuoteBeforeCreateInvariant();
testBuildNavParams();
testCategoryMessagesAreOneLocaleEach();
testCustomerTaxiSourcesDoNotHardcodeCategoryFallback();

console.log("taxiMultiStopFlow.test.ts OK");
