import assert from "node:assert/strict";
import { resolveCommissionDisplayCents } from "./commissionDisplayCents";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("prefers SoT *_cents over drifted fee_*_cents", () => {
  const c = resolveCommissionDisplayCents({
    client_cents: 1258,
    driver_cents: 297,
    restaurant_cents: 536,
    platform_cents: 425,
    fee_client_cents: 0,
    fee_driver_cents: 339,
    fee_restaurant_cents: 651,
    fee_platform_cents: 200,
  });
  assert.deepEqual(c, {
    client_cents: 1258,
    driver_cents: 297,
    restaurant_cents: 536,
    platform_cents: 425,
  });
});

test("falls back to *_amount dollars when cents missing", () => {
  const c = resolveCommissionDisplayCents({
    client_amount: 12.58,
    driver_amount: 2.97,
    restaurant_amount: 5.36,
    platform_amount: 4.25,
    fee_driver_cents: 339,
    fee_restaurant_cents: 651,
  });
  assert.equal(c.driver_cents, 297);
  assert.equal(c.restaurant_cents, 536);
  assert.equal(c.client_cents, 1258);
  assert.equal(c.platform_cents, 425);
});

test("legacy fee_* used only when SoT absent", () => {
  const c = resolveCommissionDisplayCents({
    fee_driver_cents: 339,
    fee_restaurant_cents: 651,
  });
  assert.equal(c.driver_cents, 339);
  assert.equal(c.restaurant_cents, 651);
});

console.log("commissionDisplayCents tests passed");
