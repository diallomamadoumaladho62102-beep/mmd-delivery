/**
 * Regression: taxi quote checkout must reject invalid / 0,0 coordinates.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/taxi/TaxiQuoteScreen.tsx"),
  "utf8",
);

assert.match(src, /isValidCoordinate\(pickupLat, pickupLng\)/);
assert.match(src, /isValidCoordinate\(dropoffLat, dropoffLng\)/);
assert.doesNotMatch(
  src,
  /Number\.isFinite\(pickupLat\)[\s\S]{0,120}Number\.isFinite\(dropoffLng\)/,
  "quote must not use naive isFinite for coords",
);

assert.match(src, /formatDistance\(/);
assert.match(src, /formatTripDurationFromSeconds\(/);
assert.match(src, /buildClientTaxiPriceBreakdown/);
assert.doesNotMatch(src, /taxi\.ui\.platformFee/);
assert.doesNotMatch(src, /formatDurationMinutes\(/);
assert.match(src, /ClientServiceBottomNav/);
assert.match(src, /quoteTaxiRide/);
assert.match(src, /startTaxiCheckoutFromQuote/);
assert.match(src, /confirmTaxiQuoteCheckoutPaid/);
const homeSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/taxi/TaxiHomeScreen.tsx"),
  "utf8",
);
assert.match(homeSrc, /pickupLat: pickupHasCoords/);
assert.match(homeSrc, /dropoffLat: dropoffHasCoords/);
assert.match(homeSrc, /setPickupCoords/);
assert.match(homeSrc, /setDropoffCoords/);
assert.match(src, /geocodeRequired/);
assert.doesNotMatch(src, /\$\{[^}]*\}s["'`]/);
assert.match(src, /i18n\.language/);
assert.doesNotMatch(src, /JFK Airport/);
assert.doesNotMatch(src, /123 Main St/);
assert.doesNotMatch(src, /\$26\.70/);
assert.doesNotMatch(src, /Alex M/);
assert.doesNotMatch(src, /8\.4 mi/);
assert.doesNotMatch(src, /Sarah Johnson/);

const localesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../i18n/locales",
);
const requiredQuoteKeys = [
  "title",
  "subtitle",
  "serviceFee",
  "sharedRideHint",
  "loginRequired",
  "geocodeRequired",
  "adjustPickup",
  "adjustDropoff",
  "paymentNotCompleted",
  "rideNotReady",
  "quoteUnavailable",
  "loyaltyPoints",
  "createFailed",
  "checkoutMissing",
];
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const extras = JSON.parse(
    fs.readFileSync(path.join(localesDir, lang, "extras.json"), "utf8"),
  );
  const quote = extras?.taxi?.quote ?? {};
  for (const key of requiredQuoteKeys) {
    assert.equal(typeof quote[key], "string", `${lang} taxi.quote.${key}`);
    assert.ok(String(quote[key]).trim().length > 0, `${lang} taxi.quote.${key} empty`);
  }
}

console.log("taxiQuoteCoords.regression.test.ts OK");
