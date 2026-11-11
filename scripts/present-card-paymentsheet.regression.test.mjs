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

const taxi = read("apps/mobile/src/screens/taxi/TaxiQuoteScreen.tsx");
assert.match(taxi, /nativeWallet:\s*"payment_sheet"/);
assert.match(taxi, /presentCardPaymentSheet/);

const food = read("apps/mobile/src/screens/ClientRestaurantMenuScreen.tsx");
assert.match(food, /nativeWallet:\s*"payment_sheet"/);
assert.match(food, /presentCardPaymentSheet/);

const delivery = read("apps/mobile/src/screens/DeliveryRequestScreen.tsx");
assert.match(delivery, /nativeWallet:\s*"payment_sheet"/);
assert.match(delivery, /presentCardPaymentSheet/);

const detector = read("apps/web/src/lib/stripeNativeApplePay.ts");
assert.match(detector, /payment_sheet/);

console.log("present-card-paymentsheet.regression.test.mjs OK");
