import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mergeMarketplaceDraftItems,
  resolveMarketplaceUnitPriceCents,
} from "./marketplaceOrderService";
import { resolveInitialJobStatus } from "./marketplaceDispatchService";
import { assertMarketplaceLiveMoneyAllowed } from "./marketplaceLaunchControl";
import { executeMarketplacePayouts } from "./marketplacePayoutService";
import {
  cancelMarketplaceOrder,
  transitionMarketplaceSellerOrderStatus,
} from "./marketplaceOrderLifecycle";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`ok ${name}`),
    (error) => {
      console.error(`FAIL ${name}`);
      throw error;
    }
  );
}

async function main() {
  await test("mergeMarketplaceDraftItems merges by product_id", () => {
    const merged = mergeMarketplaceDraftItems(
      [
        { product_id: "a", quantity: 1 },
        { product_id: "b", quantity: 2 },
      ],
      [{ product_id: "a", quantity: 3 }]
    );
    assert.deepEqual(
      merged.sort((x, y) => x.product_id.localeCompare(y.product_id)),
      [
        { product_id: "a", quantity: 3 },
        { product_id: "b", quantity: 2 },
      ]
    );
  });

  await test("mergeMarketplaceDraftItems replace_items drops existing-only", () => {
    const merged = mergeMarketplaceDraftItems(
      [
        { product_id: "a", quantity: 1 },
        { product_id: "b", quantity: 2 },
      ],
      [{ product_id: "a", quantity: 4 }],
      true
    );
    assert.deepEqual(merged, [{ product_id: "a", quantity: 4 }]);
  });

  await test("resolveMarketplaceUnitPriceCents prefers lower promo", () => {
    assert.equal(
      resolveMarketplaceUnitPriceCents({ price_cents: 1000, promo_price_cents: 800 }),
      800
    );
    assert.equal(
      resolveMarketplaceUnitPriceCents({ price_cents: 1000, promo_price_cents: 1200 }),
      1000
    );
  });

  await test("assertMarketplaceLiveMoneyAllowed fails without E2E ready", () => {
    const previous = process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY;
    delete process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY;
    const gate = assertMarketplaceLiveMoneyAllowed();
    assert.equal(gate.ok, false);
    if (gate.ok === false) {
      assert.equal(gate.error, "marketplace_seller_payouts_e2e_not_ready");
    }
    process.env.MARKETPLACE_SELLER_PAYOUTS_E2E_READY = previous;
  });

  await test("dispatch status pending when live off", () => {
    assert.equal(resolveInitialJobStatus(false), "dispatch_pending");
    assert.equal(resolveInitialJobStatus(true), "dispatch_ready");
  });

  await test("migration file contains stock_qty and refund_status", () => {
    const migrationPath = join(
      process.cwd(),
      "..",
      "..",
      "supabase",
      "migrations",
      "20260818120000_marketplace_phase7_production_hardening.sql"
    );
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /stock_qty/);
    assert.match(sql, /refund_status/);
    assert.match(sql, /marketplace_favorites/);
    assert.match(sql, /marketplace_seller_wallet_entries/);
    assert.match(sql, /Live money flags stay OFF/i);
  });

  await test("executeMarketplacePayouts still stub", async () => {
    const previous = process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    delete process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED;
    const result = await executeMarketplacePayouts({} as never);
    assert.equal(result.ok, true);
    assert.equal(result.executed, 0);
    assert.ok(result.ignored);
    process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED = previous;
  });

  await test("seller cancel deferred stripe (no stripe call)", async () => {
    const updates: Record<string, unknown>[] = [];
    const admin = {
      from: (table: string) => {
        if (table === "sellers") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "seller-1", user_id: "seller-user" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "seller_orders") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "order-1",
                    seller_id: "seller-1",
                    client_user_id: "client-1",
                    status: "paid",
                    payment_status: "paid",
                    refund_status: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              updates.push(payload);
              return {
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "order-1",
                        seller_id: "seller-1",
                        client_user_id: "client-1",
                        ...payload,
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await cancelMarketplaceOrder(admin as never, {
      actorUserId: "seller-user",
      orderId: "order-1",
      actorRole: "seller",
      cancelReason: "test",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.stripe_refund_deferred, true);
      assert.equal(result.refund_status, "full_refund_required");
      assert.equal(result.order.status, "canceled");
    }
    assert.equal(updates[0]?.refund_status, "full_refund_required");
    assert.equal(updates[0]?.status, "canceled");
  });

  await test("seller refuse sets deferred refund without stripe", async () => {
    const admin = {
      from: (table: string) => {
        if (table === "sellers") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "seller-1", user_id: "seller-user" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "seller_orders") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "order-1",
                      seller_id: "seller-1",
                      status: "paid",
                      payment_status: "paid",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: async () => ({
                        data: { id: "order-1", ...payload },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await transitionMarketplaceSellerOrderStatus(admin as never, {
      sellerUserId: "seller-user",
      orderId: "order-1",
      nextStatus: "refused",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.stripe_refund_deferred, true);
      assert.equal(result.refund_status, "full_refund_required");
      assert.equal(result.order.status, "refused");
    }
  });

  // K) Live checkout route still requires assertMarketplaceLiveMoneyAllowed — do not remove gate.
  await test("live checkout route still gates with assertMarketplaceLiveMoneyAllowed", () => {
    const routePath = join(
      process.cwd(),
      "app",
      "api",
      "marketplace",
      "checkout",
      "live",
      "route.ts"
    );
    const source = readFileSync(routePath, "utf8");
    assert.match(source, /assertMarketplaceLiveMoneyAllowed/);
  });

  console.log("marketplacePhase7 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
