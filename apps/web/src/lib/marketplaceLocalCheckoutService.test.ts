import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { placeMarketplaceLocalOrder } from "./marketplaceLocalCheckoutService";
import { isMarketplaceOrderPaidLike } from "./marketplaceOrderLifecycle";

type Row = Record<string, unknown>;

const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CLIENT_ID = "00000000-0000-4000-8000-0000000000c2";
const SELLER_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const ORDER_ID = "00000000-0000-4000-8000-0000000000o1";
const SELLER_ID = "00000000-0000-4000-8000-0000000000s1";

function createAdmin(tables: Record<string, Row[]>) {
  const rpcCalls: string[] = [];
  const updates: Array<{ table: string; patch: Row }> = [];

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      update: (next: Row) => {
        patch = next;
        return builder;
      },
      maybeSingle: async () => {
        const rows = matching();
        if (patch) {
          for (const row of rows) Object.assign(row, patch);
          updates.push({ table, patch });
        }
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: matching(), error: null }),
    };
    return builder;
  }

  const admin = {
    from,
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { email: `${id}@example.test` } },
          error: null,
        }),
      },
    },
  };

  return { admin: admin as unknown as SupabaseClient, rpcCalls, updates };
}

function baseTables(overrides?: { order?: Row; seller?: Row }): Record<string, Row[]> {
  return {
    seller_orders: [
      {
        id: ORDER_ID,
        seller_id: SELLER_ID,
        client_user_id: CLIENT_ID,
        status: "draft",
        payment_status: "unpaid",
        currency: "GNF",
        country_code: "GN",
        subtotal_cents: 10000,
        delivery_fee_cents: 2000,
        service_fee_cents: 500,
        total_cents: 12500,
        checkout_shadow: { total_cents: 12500 },
        paid_at: null,
        ...overrides?.order,
      },
    ],
    sellers: [
      {
        id: SELLER_ID,
        user_id: SELLER_USER_ID,
        status: "approved",
        business_name: "Conakry Shop",
        country_code: "GN",
        is_accepting_orders: true,
        ...overrides?.seller,
      },
    ],
    user_push_tokens: [],
  };
}

async function rejects(promise: Promise<unknown>, message: RegExp | string) {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof Error &&
      (typeof message === "string" ? error.message === message : message.test(error.message)),
  );
}

async function run() {
  // US / Stripe market is rejected.
  {
    const { admin } = createAdmin(
      baseTables({
        order: { country_code: "US", currency: "USD" },
        seller: { country_code: "US" },
      }),
    );
    await rejects(
      placeMarketplaceLocalOrder(admin, {
        clientUserId: CLIENT_ID,
        orderId: ORDER_ID,
        paymentMethod: "cash",
      }),
      "marketplace_local_checkout_not_available",
    );
  }

  // Non-owner cannot place the order.
  {
    const { admin, updates } = createAdmin(baseTables());
    await rejects(
      placeMarketplaceLocalOrder(admin, {
        clientUserId: OTHER_CLIENT_ID,
        orderId: ORDER_ID,
        paymentMethod: "cash",
      }),
      "Order not found",
    );
    assert.equal(updates.length, 0);
  }

  // Seller must be approved.
  {
    const { admin } = createAdmin(baseTables({ seller: { status: "pending" } }));
    await rejects(
      placeMarketplaceLocalOrder(admin, {
        clientUserId: CLIENT_ID,
        orderId: ORDER_ID,
        paymentMethod: "cash",
      }),
      "Seller not approved",
    );
  }

  // Already-placed orders are not eligible.
  {
    const { admin } = createAdmin(baseTables({ order: { status: "confirmed" } }));
    await rejects(
      placeMarketplaceLocalOrder(admin, {
        clientUserId: CLIENT_ID,
        orderId: ORDER_ID,
        paymentMethod: "cash",
      }),
      /not eligible/,
    );
  }

  // Cash success: confirmed + pending_cash, unpaid timestamp, stock reserved.
  {
    const tables = baseTables();
    const { admin, rpcCalls } = createAdmin(tables);
    const result = await placeMarketplaceLocalOrder(admin, {
      clientUserId: CLIENT_ID,
      orderId: ORDER_ID,
      paymentMethod: "cash",
    });
    assert.equal(result.ok, true);
    assert.equal(result.charge_path, "cash");
    assert.equal(result.order.status, "confirmed");
    assert.equal(result.order.payment_status, "pending_cash");
    assert.equal(result.order.currency, "GNF");
    assert.equal(result.order.paid_at, null);
    assert.equal(result.order.total_cents, 12500);
    assert.equal(
      (result.order.checkout_shadow as Record<string, unknown>).payment_method,
      "cash",
    );
    assert.ok(rpcCalls.includes("mmd_reserve_marketplace_stock"));
    // No delivery job on placement.
    assert.equal(tables.marketplace_delivery_jobs, undefined);
    // Cash orders stay actionable for the seller.
    assert.equal(
      isMarketplaceOrderPaidLike({ status: "confirmed", payment_status: "pending_cash" }),
      true,
    );
  }

  // Orange Money: prepared as unpaid / pending_checkout for /api/payments/initiate.
  {
    const { admin, rpcCalls } = createAdmin(baseTables());
    const result = await placeMarketplaceLocalOrder(admin, {
      clientUserId: CLIENT_ID,
      orderId: ORDER_ID,
      paymentMethod: "orange_money",
    });
    assert.equal(result.ok, true);
    assert.equal(result.charge_path, "orange_money");
    assert.equal("next" in result && result.next, "payments_initiate");
    assert.equal(result.order.status, "pending_checkout");
    assert.equal(result.order.payment_status, "unpaid");
    assert.equal(result.order.total_cents, 12500);
    assert.equal(rpcCalls.length, 0);
  }

  console.log("marketplaceLocalCheckoutService.test.ts OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
