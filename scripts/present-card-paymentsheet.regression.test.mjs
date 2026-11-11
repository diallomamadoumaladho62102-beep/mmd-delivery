/**
 * Regression: US card checkout must present native PaymentSheet (client_secret),
 * not only hosted Stripe Checkout URL.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const stripeUtil = read("apps/mobile/src/utils/stripe.ts");
assert.match(stripeUtil, /export async function presentCardPaymentSheet/);
// US ZIP prefill must stay gated — never force 10007 onto GN/other merchants.
assert.match(
  stripeUtil,
  /merchantCountry === "US" \? \{ postalCode: "10007" \} : \{\}/,
);
assert.match(stripeUtil, /never force a US ZIP on GN\/other markets/);

const taxi = read("apps/mobile/src/screens/taxi/TaxiQuoteScreen.tsx");
assert.match(taxi, /nativeWallet:\s*"payment_sheet"/);
assert.match(taxi, /presentCardPaymentSheet/);
// Store 89 Checkout URL path must remain in source for non-card / fallback flows.
assert.match(taxi, /WebBrowser\.openBrowserAsync/);

const food = read("apps/mobile/src/screens/ClientRestaurantMenuScreen.tsx");
assert.match(food, /nativeWallet:\s*"payment_sheet"/);
assert.match(food, /presentCardPaymentSheet/);

const delivery = read("apps/mobile/src/screens/DeliveryRequestScreen.tsx");
assert.match(delivery, /nativeWallet:\s*"payment_sheet"/);
assert.match(delivery, /presentCardPaymentSheet/);

const detector = read("apps/web/src/lib/stripeNativeApplePay.ts");
assert.match(detector, /payment_sheet/);

const autocomplete = read(
  "apps/mobile/src/components/location/AddressAutocomplete.tsx",
);
assert.match(autocomplete, /Selection must call onSelect ONLY/);

console.log("present-card-paymentsheet.regression.test.mjs OK");
