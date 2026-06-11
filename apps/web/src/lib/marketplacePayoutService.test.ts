import assert from "node:assert/strict";
import {
  isMarketplacePayoutsLiveEnabled,
  MARKETPLACE_PAYOUTS_LIVE_DISABLED_MESSAGE,
} from "./marketplacePayout";
import {
  calculateDriverMarketplacePayout,
  calculateSellerMarketplacePayout,
  executeMarketplacePayouts,
  prepareMarketplaceDriverPayout,
  prepareMarketplaceSellerPayout,
  simulateMarketplacePayouts,
} from "./marketplacePayoutService";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`ok ${name}`),
    (error) => {
      console.error(`FAIL ${name}`);
      throw error;
    }
  );
}

const originalFlag = process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;

function createMockAdmin(overrides: Record<string, unknown> = {}) {
  const state = {
    sellerPayouts: [] as Record<string, unknown>[],
    driverPayouts: [] as Record<string, unknown>[],
    orders: [
      {
        id: "order-paid-1",
        seller_id: "seller-1",
        status: "paid",
        payment_status: "paid",
        currency: "USD",
        subtotal_cents: 5000,
        service_fee_cents: 250,
        total_cents: 5799,
      },
    ] as Record<string, unknown>[],
    jobs: [
      {
        id: "job-1",
        seller_order_id: "order-paid-1",
        seller_id: "seller-1",
        status: "delivered",
        assigned_driver_id: "driver-1",
        driver_earning_cents: 800,
        platform_margin_cents: 200,
      },
    ] as Record<string, unknown>[],
    stripeCalls: 0,
    ...overrides,
  };

  const from = (table: string) => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => ({
        maybeSingle: async () => {
          if (table === "marketplace_seller_payouts") {
            return {
              data: state.sellerPayouts.find((r) => r[col] === val) ?? null,
              error: null,
            };
          }
          if (table === "marketplace_driver_payouts") {
            return {
              data: state.driverPayouts.find((r) => r[col] === val) ?? null,
              error: null,
            };
          }
          if (table === "seller_orders") {
            return {
              data: state.orders.find((r) => r[col] === val) ?? null,
              error: null,
            };
          }
          if (table === "marketplace_delivery_jobs") {
            return {
              data: state.jobs.find((r) => r[col] === val) ?? null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
      }),
    }),
    insert: (payload: Record<string, unknown>) => ({
      select: (_cols: string) => ({
        maybeSingle: async () => {
          if (table === "marketplace_seller_payouts") {
            const row = { id: "seller-payout-1", ...payload };
            state.sellerPayouts.push(row);
            return { data: row, error: null };
          }
          if (table === "marketplace_driver_payouts") {
            const row = { id: "driver-payout-1", ...payload };
            state.driverPayouts.push(row);
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  });

  return { admin: { from } as never, state };
}

async function main() {
  await test("payout live flag defaults to disabled", () => {
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    assert.equal(isMarketplacePayoutsLiveEnabled(), false);
    assert.equal(
      MARKETPLACE_PAYOUTS_LIVE_DISABLED_MESSAGE,
      "Marketplace live payouts are not enabled yet"
    );
  });

  await test("calculateSellerMarketplacePayout derives net from subtotal commission", () => {
    const result = calculateSellerMarketplacePayout({
      subtotal_cents: 5000,
      service_fee_cents: 250,
    });
    assert.equal(result.gross_amount_cents, 5000);
    assert.equal(result.platform_fee_cents, 250);
    assert.equal(result.seller_net_amount_cents, 4750);
  });

  await test("calculateDriverMarketplacePayout sums earning and bonus", () => {
    const result = calculateDriverMarketplacePayout({
      driver_earning_cents: 800,
      bonus_cents: 100,
    });
    assert.equal(result.total_driver_payout_cents, 900);
  });

  await test("paid seller_order creates seller payout pending", async () => {
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    const { admin, state } = createMockAdmin();

    const result = await prepareMarketplaceSellerPayout(admin, {
      sellerOrderId: "order-paid-1",
    });

    assert.equal(result.ok, true);
    assert.ok(result.payout);
    assert.equal(result.payout?.status, "pending");
    assert.equal(result.payout?.payout_live_enabled, false);
    assert.equal(state.sellerPayouts.length, 1);
    assert.equal(state.stripeCalls, 0);
  });

  await test("delivered marketplace job creates driver payout pending", async () => {
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    const { admin, state } = createMockAdmin();

    const result = await prepareMarketplaceDriverPayout(admin, {
      marketplaceDeliveryJobId: "job-1",
    });

    assert.equal(result.ok, true);
    assert.ok(result.payout);
    assert.equal(result.payout?.status, "pending");
    assert.equal(result.payout?.total_driver_payout_cents, 800);
    assert.equal(state.driverPayouts.length, 1);
  });

  await test("flag OFF blocks executeMarketplacePayouts", async () => {
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    const { admin } = createMockAdmin();

    const result = await executeMarketplacePayouts(admin);
    assert.equal(result.ok, true);
    assert.equal(result.ignored, "marketplace_payouts_live_disabled");
    assert.equal(result.executed, 0);
  });

  await test("simulate payout does not call Stripe", async () => {
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    const { admin, state } = createMockAdmin();
    state.sellerPayouts.push({
      id: "seller-payout-1",
      seller_order_id: "order-paid-1",
      status: "pending",
      stripe_transfer_id: null,
    });

    const result = await simulateMarketplacePayouts(admin, {
      sellerPayoutId: "seller-payout-1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.simulation?.stripe_transfer_called, false);
    assert.equal(result.ignored, "marketplace_payouts_live_disabled");
  });

  process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED = originalFlag;
  console.log("marketplacePayoutService tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
