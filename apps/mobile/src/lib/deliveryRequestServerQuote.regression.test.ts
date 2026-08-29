import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/DeliveryRequestScreen.tsx"),
  "utf8"
);

assert.match(src, /quoteDeliveryRequest\(/);
assert.match(src, /expectedQuoteTotalCents/);
assert.match(src, /deliveryRequest\.errors\.quoteRequired/);
assert.match(src, /setServerPricing\(quote\)/);
assert.match(src, /money\(displayDeliveryFee/);
assert.doesNotMatch(src, /computeDeliveryPricingFromConfig\(dMiles/);

const navigator = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../navigation/AppNavigator.tsx"),
  "utf8"
);
assert.match(navigator, /pickupAddress\?: string/);
assert.match(navigator, /initialItems\?:/);

const ai = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/MmdAiScreen.tsx"),
  "utf8"
);
assert.match(ai, /navigation\.navigate\("TaxiHome", \{/);
assert.match(ai, /initialItems:/);

console.log("deliveryRequestServerQuote.regression.test.ts OK");
