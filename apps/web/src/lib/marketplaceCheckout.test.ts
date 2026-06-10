import assert from "node:assert/strict";
import {
  computeMarketplaceCheckoutShadow,
  isMarketplaceCheckoutEnabled,
  MARKETPLACE_CHECKOUT_COMING_SOON,
} from "./marketplaceCheckout";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const originalFlag = process.env.MARKETPLACE_CHECKOUT_ENABLED;

test("computeMarketplaceCheckoutShadow totals subtotal + delivery + service", () => {
  const shadow = computeMarketplaceCheckoutShadow([
    { price_cents: 1000, quantity: 2 },
    { price_cents: 500, quantity: 1 },
  ]);

  assert.equal(shadow.subtotal_cents, 2500);
  assert.equal(
    shadow.total_cents,
    shadow.subtotal_cents + shadow.delivery_fee_cents + shadow.service_fee_cents
  );
  assert.equal(shadow.pricing_engine_version, "marketplace_checkout_shadow_v1");
});

test("checkout flag defaults to disabled with coming soon message", () => {
  delete process.env.MARKETPLACE_CHECKOUT_ENABLED;
  assert.equal(isMarketplaceCheckoutEnabled(), false);

  const shadow = computeMarketplaceCheckoutShadow([{ price_cents: 1200, quantity: 1 }]);
  assert.equal(shadow.checkout_enabled, false);
  assert.equal(shadow.message, MARKETPLACE_CHECKOUT_COMING_SOON);
});

process.env.MARKETPLACE_CHECKOUT_ENABLED = originalFlag;

console.log("marketplaceCheckout tests passed");
