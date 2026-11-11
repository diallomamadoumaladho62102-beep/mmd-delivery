/**
 * US PaymentSheet cert path: DEV fill + autocomplete must not clear coords.
 * Protects TaxiHome/ClientProfile contract used since App Store build 89.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const home = read("apps/mobile/src/screens/taxi/TaxiHomeScreen.tsx");
assert.match(home, /US_CERT_TAXI_ROUTE/);
assert.match(home, /Load US cert addresses/);
assert.match(home, /testID="taxi-us-cert-fill"/);
assert.match(home, /testID="taxi-get-estimate"/);
assert.match(home, /accessibilityLabel="Get estimate"/);
assert.match(home, /40\.7128/);
assert.match(home, /40\.7484/);
// Parent still clears coords on manual edit (expected).
assert.match(
  home,
  /onChangeText=\{\(text\) => \{\s*setPickup\(text\);\s*setPickupLocationId\(""\);\s*setPickupCoords\(null\);/s,
);
// Parent restores coords on select.
assert.match(
  home,
  /onSelect=\{\(place\) => \{\s*setPickup\(place\.fullAddress\);[\s\S]*?setPickupCoords\(\{\s*lat: place\.latitude,\s*lng: place\.longitude \}\);/m,
);

const autocomplete = read(
  "apps/mobile/src/components/location/AddressAutocomplete.tsx",
);
assert.match(
  autocomplete,
  /Selection must call onSelect ONLY/,
  "select must not call onChangeText before onSelect (coords race)",
);
assert.doesNotMatch(
  autocomplete,
  /setOpen\(false\);\s*onChangeText\(place\.fullAddress\);\s*onSelect/,
);
assert.doesNotMatch(
  autocomplete,
  /setOpen\(false\);\s*onChangeText\(geo\.fullAddress\);\s*onSelect/,
);

const checkout = read(
  "apps/mobile/src/components/checkout/ClientCheckoutPaymentMethods.tsx",
);
assert.match(checkout, /testID="checkout-pay-card"/);

console.log("taxi-us-cert-fill.regression.test.mjs OK");
