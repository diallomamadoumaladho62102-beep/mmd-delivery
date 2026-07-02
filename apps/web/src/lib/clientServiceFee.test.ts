import assert from "node:assert/strict";
import test from "node:test";
import {
  computeClientServiceFee,
  computeClientServiceFeeFromCentsBase,
  computeServiceFeeBaseAmount,
  parseServiceFeeConfig,
} from "@/lib/clientServiceFee";
import { buildStripeCheckoutLineItems } from "@/lib/stripeCheckoutBreakdown";

test("service fee OFF leaves total components at zero", () => {
  const result = computeClientServiceFee(
    { enabled: false, pct: 10, fixedCents: 99 },
    50
  );
  assert.equal(result.enabled, false);
  assert.equal(result.serviceFee, 0);
  assert.equal(result.serviceFeeCents, 0);
});

test("service fee ON applies percent of base", () => {
  const result = computeClientServiceFee(
    { enabled: true, pct: 10, fixedCents: 0 },
    80
  );
  assert.equal(result.serviceFee, 8);
  assert.equal(result.serviceFeeCents, 800);
});

test("service fee ON uses minimum fixed cents when higher", () => {
  const result = computeClientServiceFee(
    { enabled: true, pct: 5, fixedCents: 299 },
    20
  );
  assert.equal(result.serviceFeeCents, 299);
  assert.equal(result.serviceFee, 2.99);
});

test("delivery base falls back to delivery fee when subtotal is zero", () => {
  const base = computeServiceFeeBaseAmount({
    subtotalAfterDiscount: 0,
    deliveryFeeAfterDiscount: 12.5,
  });
  assert.equal(base, 12.5);
});

test("food total with service fee enabled increases by fee amount", () => {
  const subtotal = 80;
  const tax = 7.1;
  const delivery = 12;
  const fee = computeClientServiceFee(
    { enabled: true, pct: 10, fixedCents: 0 },
    subtotal
  );
  const total = subtotal + tax + delivery + fee.serviceFee;
  assert.equal(fee.serviceFee, 8);
  assert.equal(total, 107.1);
});

test("marketplace cents base helper", () => {
  const result = computeClientServiceFeeFromCentsBase(
    { enabled: true, pct: 5, fixedCents: 99 },
    2000
  );
  assert.equal(result.serviceFeeCents, 100);
});

test("parseServiceFeeConfig defaults disabled", () => {
  const config = parseServiceFeeConfig(null);
  assert.deepEqual(config, { enabled: false, pct: 0, fixedCents: 0 });
});

test("stripe checkout exposes separate service fee line when enabled", () => {
  const lineItems = buildStripeCheckoutLineItems({
    currency: "USD",
    productName: "MMD Order abc",
    breakdown: {
      subtotalCents: 8000,
      deliveryFeeCents: 1200,
      serviceFeeCents: 800,
      taxCents: 710,
      totalCents: 10710,
    },
  });

  assert.equal(lineItems.length, 4);
  assert.match(String(lineItems[2]?.price_data?.product_data?.name ?? ""), /Service fee/i);
});
