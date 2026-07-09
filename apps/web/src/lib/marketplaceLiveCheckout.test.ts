import assert from "node:assert/strict";
import {
  isMarketplaceCheckoutLiveEnabled,
  MARKETPLACE_CHECKOUT_LIVE_COMING_SOON,
} from "./marketplaceLiveCheckout";
import {
  handleMarketplaceStripePayment,
  isMarketplaceStripeModule,
  pickSellerOrderIdFromMetadata,
} from "./marketplaceStripeWebhook";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`ok ${name}`),
    (error) => {
      console.error(`FAIL ${name}`);
      throw error;
    }
  );
}

const originalLiveFlag = process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED;

async function main() {
  await test("live checkout flag defaults to disabled", () => {
    delete process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED;
    delete process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY;
    assert.equal(isMarketplaceCheckoutLiveEnabled(), false);
    assert.equal(
      MARKETPLACE_CHECKOUT_LIVE_COMING_SOON,
      "Marketplace live checkout is not enabled yet"
    );
  });

  await test("live checkout stays OFF without seller payouts E2E even if env live", () => {
    process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = "true";
    delete process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY;
    assert.equal(isMarketplaceCheckoutLiveEnabled(), false);
  });

  await test("marketplace stripe metadata parser recognizes seller_order_id", () => {
    assert.equal(
      pickSellerOrderIdFromMetadata({
        module: "marketplace",
        seller_order_id: "abc-123",
      }),
      "abc-123"
    );
    assert.equal(isMarketplaceStripeModule({ module: "marketplace" }), true);
    assert.equal(isMarketplaceStripeModule({ module: "taxi" }), false);
  });

  await test("webhook handler ignores paid transition when live flag off", async () => {
    delete process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED;
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: {} as never,
      sellerOrderId: "missing",
      source: "test",
    });
    assert.equal(result.ok, true);
    assert.equal(result.ignored, "marketplace_live_checkout_disabled");
  });

  process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = originalLiveFlag;
  console.log("marketplaceLiveCheckout tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
