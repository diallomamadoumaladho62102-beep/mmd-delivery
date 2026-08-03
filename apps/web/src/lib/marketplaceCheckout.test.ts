import assert from "node:assert/strict";
import test from "node:test";
import {
  isMarketplaceCheckoutEnabled,
  MARKETPLACE_CHECKOUT_COMING_SOON,
} from "./marketplaceCheckout";
import { quoteMarketplaceWithPricingEngine } from "./pricingEngine/engine/orchestrate/quoteMarketplace";

test("quoteMarketplaceWithPricingEngine totals subtotal + delivery + service", () => {
  const prev = process.env.MARKETPLACE_CHECKOUT_ENABLED;
  process.env.MARKETPLACE_CHECKOUT_ENABLED = "true";
  try {
    const quote = quoteMarketplaceWithPricingEngine([
      { price_cents: 1000, quantity: 2 },
    ]);
    assert.equal(quote.subtotal_cents, 2000);
    assert.ok(quote.delivery_fee_cents > 0);
    assert.equal(
      quote.total_cents,
      quote.subtotal_cents + quote.delivery_fee_cents + quote.service_fee_cents
    );
    assert.equal(quote.checkout_enabled, true);
    assert.equal(quote.pe.chargePath, "engine");
  } finally {
    if (prev === undefined) delete process.env.MARKETPLACE_CHECKOUT_ENABLED;
    else process.env.MARKETPLACE_CHECKOUT_ENABLED = prev;
  }
});

test("marketplace checkout disabled message", () => {
  const prev = process.env.MARKETPLACE_CHECKOUT_ENABLED;
  delete process.env.MARKETPLACE_CHECKOUT_ENABLED;
  try {
    assert.equal(isMarketplaceCheckoutEnabled(), false);
    const quote = quoteMarketplaceWithPricingEngine([
      { price_cents: 1200, quantity: 1 },
    ]);
    assert.equal(quote.message, MARKETPLACE_CHECKOUT_COMING_SOON);
  } finally {
    if (prev !== undefined) process.env.MARKETPLACE_CHECKOUT_ENABLED = prev;
  }
});
