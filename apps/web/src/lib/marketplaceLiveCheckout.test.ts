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
const originalPayoutsE2EFlag = process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY;

type SellerOrderRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  payment_status: string | null;
  total_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
};

type UpdateSpy = { updateCount: number; updatePayload: unknown };

// Minimal chainable Supabase mock: returns the seller_order row on the initial
// load, tracks whether `.update()` was ever invoked, and resolves harmlessly for
// any other table (fire-and-forget dispatch/payout prep after a paid update).
function makeSellerOrdersClient(row: SellerOrderRow, spy: UpdateSpy) {
  return {
    from(table: string) {
      const state = { isUpdate: false };
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      Object.assign(chain, {
        select: passthrough,
        eq: passthrough,
        neq: passthrough,
        in: passthrough,
        order: passthrough,
        limit: passthrough,
        upsert: passthrough,
        insert: passthrough,
        update: (payload: unknown) => {
          if (table === "seller_orders") {
            spy.updateCount += 1;
            spy.updatePayload = payload;
          }
          state.isUpdate = true;
          return chain;
        },
        async maybeSingle() {
          if (table === "seller_orders") {
            if (state.isUpdate) {
              return {
                data: { id: row.id, payment_status: "paid", status: "paid" },
                error: null,
              };
            }
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          return { data: null, error: null };
        },
        then(resolve: (v: { data: null; error: null }) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      });
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as never;
}

function baseSellerOrderRow(): SellerOrderRow {
  return {
    id: "so_1",
    seller_id: "seller_1",
    client_user_id: "user_1",
    status: "pending_payment",
    payment_status: "pending",
    total_cents: 5000,
    currency: "usd",
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    paid_at: null,
  };
}

function paymentIntentLike(
  status: string,
  metadata: Record<string, unknown>
): never {
  return {
    id: "pi_test",
    status,
    amount: 5000,
    amount_received: 5000,
    currency: "usd",
    metadata,
  } as never;
}

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

  // ---- Settlement hardening (live checkout ON) ---------------------------
  process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = "true";
  process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY = "true";

  await test("marketplace webhook rejects a taxi PI (cross-service) without UPDATE", async () => {
    const spy: UpdateSpy = { updateCount: 0, updatePayload: null };
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: makeSellerOrdersClient(baseSellerOrderRow(), spy),
      sellerOrderId: "so_1",
      source: "test",
      paymentIntent: paymentIntentLike("succeeded", {
        metadata_schema_version: "1",
        service_type: "taxi",
        module: "taxi",
        user_id: "user_1",
        taxi_ride_id: "ride_1",
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /^payment_expectation_service_type/);
    assert.equal(spy.updateCount, 0);
  });

  await test("marketplace webhook rejects a non-succeeded PI without UPDATE", async () => {
    const spy: UpdateSpy = { updateCount: 0, updatePayload: null };
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: makeSellerOrdersClient(baseSellerOrderRow(), spy),
      sellerOrderId: "so_1",
      source: "test",
      paymentIntent: paymentIntentLike("processing", {
        metadata_schema_version: "1",
        service_type: "marketplace",
        module: "marketplace",
        user_id: "user_1",
        seller_order_id: "so_1",
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /^payment_intent_not_succeeded/);
    assert.equal(spy.updateCount, 0);
  });

  await test("marketplace webhook rejects wrong user on versioned PI without UPDATE", async () => {
    const spy: UpdateSpy = { updateCount: 0, updatePayload: null };
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: makeSellerOrdersClient(baseSellerOrderRow(), spy),
      sellerOrderId: "so_1",
      source: "test",
      paymentIntent: paymentIntentLike("succeeded", {
        metadata_schema_version: "1",
        service_type: "marketplace",
        module: "marketplace",
        user_id: "attacker",
        seller_order_id: "so_1",
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /^payment_expectation_user/);
    assert.equal(spy.updateCount, 0);
  });

  await test("marketplace webhook accepts a valid versioned marketplace PI (UPDATE runs)", async () => {
    const spy: UpdateSpy = { updateCount: 0, updatePayload: null };
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: makeSellerOrdersClient(baseSellerOrderRow(), spy),
      sellerOrderId: "so_1",
      source: "test",
      paymentIntent: paymentIntentLike("succeeded", {
        metadata_schema_version: "1",
        service_type: "marketplace",
        module: "marketplace",
        user_id: "user_1",
        seller_order_id: "so_1",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(spy.updateCount, 1);
  });

  await test("marketplace webhook accepts a historical PI without metadata (compat, UPDATE runs)", async () => {
    const spy: UpdateSpy = { updateCount: 0, updatePayload: null };
    const result = await handleMarketplaceStripePayment({
      supabaseAdmin: makeSellerOrdersClient(baseSellerOrderRow(), spy),
      sellerOrderId: "so_1",
      source: "test",
      paymentIntent: paymentIntentLike("succeeded", {}),
    });
    assert.equal(result.ok, true);
    assert.equal(spy.updateCount, 1);
  });

  process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = originalLiveFlag;
  process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY = originalPayoutsE2EFlag;
  console.log("marketplaceLiveCheckout tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
