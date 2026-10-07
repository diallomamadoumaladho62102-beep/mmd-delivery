/**
 * Package accept must send the pending offer id to the hardened backend.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return fs.readFileSync(path.join(here, rel), "utf8");
}

const api = read("./deliveryRequestDriverApi.ts");
const offerApi = read("./driverOrderDriverApi.ts");
const details = read("../screens/DriverOrderDetailsScreen.tsx");
const home = read("../screens/DriverHomeScreen.tsx");

assert.match(
  api,
  /offer_id: offer/,
  "acceptDeliveryRequest includes offer_id when the driver has one",
);
assert.match(
  api,
  /if \(!offer\)/,
  "legacy package accept refuses to send delivery_request_id alone",
);
assert.doesNotMatch(
  api,
  /\.\.\.\(offer \? \{ offer_id: offer \} : \{\}\)/,
  "legacy package accept must not omit offer_id",
);
assert.match(
  offerApi,
  /\/api\/delivery-requests\/offers\/accept/,
  "dedicated package offer accept hits the offer endpoint",
);
assert.match(
  offerApi,
  /\{\s*offer_id:\s*offerId\s*\}/,
  "dedicated package offer accept sends offer_id",
);
assert.match(
  details,
  /acceptDeliveryRequestOffer/,
  "order details accept uses the offer endpoint",
);
assert.match(
  details,
  /delivery_request_driver_offers/,
  "order details looks up the pending package offer",
);
assert.doesNotMatch(
  details,
  /acceptDeliveryRequest\(order\.id\)/,
  "order details must not accept a package request without offer_id",
);
assert.match(
  home,
  /acceptDeliveryRequestOffer\(offer\.offer_id\)/,
  "home accept sends the package offer id",
);
assert.doesNotMatch(
  home,
  /acceptDeliveryRequest\(orderId\)/,
  "home must not fall back to offer-less package accept",
);

console.log("deliveryRequestOfferAccept.regression.test.ts OK");
