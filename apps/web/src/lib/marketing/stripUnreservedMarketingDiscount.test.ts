import assert from "node:assert/strict";
import { computeStripUnreservedMarketingDiscount } from "./stripUnreservedMarketingDiscount";

const base = computeStripUnreservedMarketingDiscount({
  kind: "food",
  entityId: "ord_1",
  marketingOrderDiscount: 2,
  marketingDeliveryDiscount: 1,
  discounts: 5,
  deliveryFee: 3,
  total: 20,
});

assert.equal(base.stripped, true);
assert.equal(base.newDiscounts, 2);
assert.equal(base.newDeliveryFee, 4);
assert.equal(base.newTotal, 23);

const noop = computeStripUnreservedMarketingDiscount({
  kind: "delivery",
  entityId: "dr_1",
  marketingOrderDiscount: 0,
  marketingDeliveryDiscount: 0,
  discounts: 1,
  deliveryFee: 5,
  total: 10,
});
assert.equal(noop.stripped, false);
assert.equal(noop.newTotal, 10);

console.log("stripUnreservedMarketingDiscount.test.ts: ok");
