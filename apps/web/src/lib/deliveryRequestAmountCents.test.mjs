import assert from "node:assert/strict";
import {
  normalizeCurrencyCode,
  resolveDeliveryRequestAmountCents,
} from "./deliveryRequestAmountCents.ts";

assert.equal(resolveDeliveryRequestAmountCents({ total_cents: 2599 }), 2599);
assert.equal(resolveDeliveryRequestAmountCents({ total: 25.99 }), 2599);
assert.equal(resolveDeliveryRequestAmountCents({ total: 0 }), null);
assert.equal(normalizeCurrencyCode("USD"), "usd");
assert.equal(normalizeCurrencyCode(""), "usd");

console.log("deliveryRequestAmountCents.test.mjs: ok");
