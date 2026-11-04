import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLocalCashLedgerRow,
  collectDeliveryRequestCash,
  collectFoodOrderCash,
  collectMarketplaceOrderCash,
  evaluateDeliveryCashCollect,
  evaluateFoodCashCollect,
  evaluateMarketplaceCashCollect,
  localCashAllowsDispatch,
  withOptionalPaymentMethod,
  type LocalCashSnapshot,
} from "./guineaLocalCashCollect";

type Row = Record<string, unknown>;

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const RESTAURANT = "00000000-0000-4000-8000-0000000000e1";
const SELLER_USER = "00000000-0000-4000-8000-0000000000a1";
const STRANGER = "00000000-0000-4000-8000-0000000000f9";
const ENTITY_ID = "00000000-0000-4000-8000-000000000001";
const SELLER_ID = "00000000-0000-4000-8000-0000000000b1";

function snapshot(overrides: Partial<LocalCashSnapshot> = {}): LocalCashSnapshot {
  return {
    id: ENTITY_ID,
    clientUserId: CLIENT,
    driverId: DRIVER,
    restaurantUserId: RESTAURANT,
    sellerUserId: SELLER_USER,
    status: "delivered",
    paymentMethod: "cash",
    paymentStatus: "pending_cash",
    currency: "GNF",
    countryCode: "GN",
    totalCents: 45000,
    ...overrides,
  };
}

function createAdmin(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const builder: Record<string, unknown> = {
      select: () => builder,
      limit: () => builder,
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
      insert: async (row: Row) => {
        inserts.push({ table, row });
        (tables[table] ??= []).push({ id: `${table}-${inserts.length}`, ...row });
        return { error: null };
      },
      maybeSingle: async () => {
        const rows = matching();
        if (patch) {
          for (const row of rows) Object.assign(row, patch);
          if (rows.length) updates.push({ table, patch });
        }
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
    };
    return builder;
  }

  const admin = {
    from,
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { email: `${id}@example.test` } },
          error: null,
        }),
      },
    },
  };
  return { admin: admin as unknown as SupabaseClient, updates, inserts, tables };
}

function deliveryTables(overrides: Row = {}): Record<string, Row[]> {
  return {
    delivery_requests: [
      {
        id: ENTITY_ID,
        client_user_id: CLIENT,
        created_by: CLIENT,
        driver_id: DRIVER,
        status: "delivered",
        payment_method: "cash",
        payment_status: "pending_cash",
        currency: "GNF",
        total_cents: 45000,
        paid_at: null,
        ...overrides,
      },
    ],
    wallet_ledger: [],
  };
}

async function run() {
  // --- localCashAllowsDispatch -------------------------------------------------
  assert.equal(localCashAllowsDispatch({ paymentStatus: "paid", paymentMethod: null }), true);
  assert.equal(
    localCashAllowsDispatch({
      paymentStatus: "pending_cash",
      paymentMethod: "cash",
      currency: "GNF",
      countryCode: "GN",
    }),
    true,
  );
  // Unknown country is inferred from GNF.
  assert.equal(
    localCashAllowsDispatch({ paymentStatus: "pending_cash", paymentMethod: "cash", currency: "GNF" }),
    true,
  );
  // US paid-only is unchanged.
  assert.equal(
    localCashAllowsDispatch({
      paymentStatus: "pending_cash",
      paymentMethod: "cash",
      currency: "USD",
      countryCode: "US",
    }),
    false,
  );
  assert.equal(
    localCashAllowsDispatch({ paymentStatus: "unpaid", paymentMethod: "cash", currency: "GNF" }),
    false,
  );
  assert.equal(
    localCashAllowsDispatch({ paymentStatus: "pending_cash", paymentMethod: null, currency: "GNF" }),
    false,
  );
  assert.equal(
    localCashAllowsDispatch({
      paymentStatus: "pending_cash",
      paymentMethod: "cash",
      currency: "GNF",
      countryCode: "SN",
    }),
    false,
  );

  // --- delivery evaluate -------------------------------------------------------
  assert.deepEqual(evaluateDeliveryCashCollect(snapshot(), DRIVER), {
    ok: true,
    idempotent: false,
    amountGnf: 45000,
    actorRole: "driver",
  });
  assert.deepEqual(evaluateDeliveryCashCollect(null, DRIVER), {
    ok: false,
    status: 404,
    error: "entity_not_found",
  });
  for (const actor of [CLIENT, STRANGER, RESTAURANT, ""]) {
    const decision = evaluateDeliveryCashCollect(snapshot(), actor);
    assert.equal(decision.ok, false);
    assert.equal(!decision.ok && decision.error, "cash_forbidden");
  }
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ driverId: null }), DRIVER) as { error: string }).error,
    "cash_forbidden",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ status: "picked_up" }), DRIVER) as { error: string })
      .error,
    "delivery_not_completed",
  );
  assert.equal(evaluateDeliveryCashCollect(snapshot({ status: "completed" }), DRIVER).ok, true);
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ status: "cancelled" }), DRIVER) as { error: string })
      .error,
    "entity_canceled",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ paymentMethod: "card" }), DRIVER) as { error: string })
      .error,
    "not_cash",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ currency: "USD" }), DRIVER) as { error: string }).error,
    "currency_mismatch",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ countryCode: "US" }), DRIVER) as { error: string })
      .error,
    "market_mismatch",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ totalCents: 0 }), DRIVER) as { error: string }).error,
    "amount_missing",
  );
  assert.equal(
    (evaluateDeliveryCashCollect(snapshot({ paymentStatus: "paid" }), DRIVER) as { error: string })
      .error,
    "invalid_payment_status",
  );
  assert.deepEqual(
    evaluateDeliveryCashCollect(snapshot({ paymentStatus: "cash_collected" }), DRIVER),
    { ok: true, idempotent: true, amountGnf: 45000, actorRole: "driver" },
  );

  // --- food evaluate: driver OR restaurant owner ------------------------------
  const driverFood = evaluateFoodCashCollect(snapshot(), DRIVER);
  assert.equal(driverFood.ok && driverFood.actorRole, "driver");
  const restaurantFood = evaluateFoodCashCollect(snapshot(), RESTAURANT);
  assert.equal(restaurantFood.ok && restaurantFood.actorRole, "restaurant");
  assert.equal(
    (evaluateFoodCashCollect(snapshot(), CLIENT) as { error: string }).error,
    "cash_forbidden",
  );
  assert.equal(
    (evaluateFoodCashCollect(snapshot({ status: "ready" }), DRIVER) as { error: string }).error,
    "order_not_delivered",
  );

  // --- marketplace evaluate: seller owner only --------------------------------
  for (const status of [
    "confirmed",
    "accepted",
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
    "fulfilled",
  ]) {
    assert.equal(
      evaluateMarketplaceCashCollect(snapshot({ status }), SELLER_USER).ok,
      true,
      status,
    );
  }
  for (const status of ["draft", "pending_checkout", "pending", "paid"]) {
    assert.equal(
      (evaluateMarketplaceCashCollect(snapshot({ status }), SELLER_USER) as { error: string }).error,
      "order_not_collectable",
      status,
    );
  }
  assert.equal(
    (evaluateMarketplaceCashCollect(snapshot({ status: "canceled" }), SELLER_USER) as {
      error: string;
    }).error,
    "entity_canceled",
  );
  assert.equal(
    (evaluateMarketplaceCashCollect(snapshot({ status: "refused" }), SELLER_USER) as {
      error: string;
    }).error,
    "entity_canceled",
  );
  for (const actor of [CLIENT, DRIVER, RESTAURANT, STRANGER]) {
    assert.equal(
      (evaluateMarketplaceCashCollect(snapshot({ status: "ready" }), actor) as { error: string })
        .error,
      "cash_forbidden",
    );
  }

  // --- ledger row ---------------------------------------------------------------
  const ledger = buildLocalCashLedgerRow({
    kind: "food_order",
    entityId: ENTITY_ID,
    accountUserId: RESTAURANT,
    accountRole: "restaurant",
    amountGnf: 45000,
  });
  assert.equal(ledger.reference_type, "cash_collection");
  assert.equal(ledger.reference_id, ENTITY_ID);
  assert.equal(ledger.account_type, "restaurant");
  assert.equal(ledger.account_user_id, RESTAURANT);
  assert.equal(ledger.amount_cents, 45000);
  assert.equal(ledger.currency, "GNF");
  assert.equal((ledger.metadata as Row).entity_type, "food_order");

  // --- optional payment_method column retry ------------------------------------
  {
    const calls: boolean[] = [];
    const result = await withOptionalPaymentMethod(async (include) => {
      calls.push(include);
      return include
        ? { error: { message: 'column orders.payment_method does not exist' } }
        : { error: null };
    });
    assert.deepEqual(calls, [true, false]);
    assert.equal(result.error, null);
  }

  // --- collect service: delivery success ---------------------------------------
  {
    const { admin, updates, inserts, tables } = createAdmin(deliveryTables());
    const result = await collectDeliveryRequestCash(admin, {
      actorUserId: DRIVER,
      requestId: ENTITY_ID,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.idempotent, false);
    assert.equal(result.body.payment_status, "cash_collected");
    assert.equal(result.body.amount_gnf, 45000);
    assert.equal(result.body.ledger_recorded, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].patch.payment_status, "cash_collected");
    assert.ok(typeof updates[0].patch.paid_at === "string");
    assert.equal(tables.delivery_requests[0].payment_status, "cash_collected");
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].table, "wallet_ledger");
    assert.equal(inserts[0].row.reference_id, ENTITY_ID);
    assert.equal(inserts[0].row.account_user_id, DRIVER);

    // Second confirmation: idempotent, no second update and no second ledger line.
    const again = await collectDeliveryRequestCash(admin, {
      actorUserId: DRIVER,
      requestId: ENTITY_ID,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotent, true);
    assert.equal(updates.length, 1);
    assert.equal(inserts.length, 1);
  }

  // --- collect service: non-driver is refused, nothing written -----------------
  {
    const { admin, updates, inserts } = createAdmin(deliveryTables());
    const result = await collectDeliveryRequestCash(admin, {
      actorUserId: CLIENT,
      requestId: ENTITY_ID,
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "cash_forbidden");
    assert.equal(updates.length, 0);
    assert.equal(inserts.length, 0);
  }

  // --- collect service: not delivered yet / not found / missing id -------------
  {
    const { admin, updates } = createAdmin(deliveryTables({ status: "picked_up" }));
    const result = await collectDeliveryRequestCash(admin, {
      actorUserId: DRIVER,
      requestId: ENTITY_ID,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "delivery_not_completed");
    assert.equal(updates.length, 0);
  }
  {
    const { admin } = createAdmin(deliveryTables());
    const result = await collectDeliveryRequestCash(admin, {
      actorUserId: DRIVER,
      requestId: "00000000-0000-4000-8000-0000000000ff",
    });
    assert.equal(result.status, 404);
    const missing = await collectDeliveryRequestCash(admin, { actorUserId: DRIVER, requestId: "" });
    assert.equal(missing.status, 400);
  }

  // --- collect service: Guinea rehearsal accounts cannot write live money ------
  {
    const isolatedDriver = "05c34009-b050-454c-a94d-c4c803b26815";
    const { admin, updates, inserts } = createAdmin(deliveryTables({ driver_id: isolatedDriver }));
    const result = await collectDeliveryRequestCash(admin, {
      actorUserId: isolatedDriver,
      requestId: ENTITY_ID,
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "guinea_test_live_operation_blocked");
    assert.equal(updates.length, 0);
    assert.equal(inserts.length, 0);
  }

  // --- collect service: food (restaurant owner) --------------------------------
  {
    const tables: Record<string, Row[]> = {
      orders: [
        {
          id: ENTITY_ID,
          kind: "food",
          client_user_id: CLIENT,
          driver_id: DRIVER,
          restaurant_user_id: RESTAURANT,
          status: "delivered",
          payment_method: "cash",
          payment_status: "pending_cash",
          currency: "GNF",
          total_cents: 45000,
        },
      ],
      wallet_ledger: [],
    };
    const { admin, inserts } = createAdmin(tables);
    const result = await collectFoodOrderCash(admin, {
      actorUserId: RESTAURANT,
      orderId: ENTITY_ID,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.idempotent, false);
    assert.equal(tables.orders[0].payment_status, "cash_collected");
    assert.equal(inserts[0].row.account_type, "restaurant");
  }

  // --- collect service: marketplace (seller owner) -----------------------------
  {
    const tables: Record<string, Row[]> = {
      seller_orders: [
        {
          id: ENTITY_ID,
          seller_id: SELLER_ID,
          client_user_id: CLIENT,
          status: "out_for_delivery",
          payment_status: "pending_cash",
          currency: "GNF",
          country_code: "GN",
          total_cents: 12500,
          checkout_shadow: { payment_method: "cash" },
          paid_at: null,
        },
      ],
      sellers: [{ id: SELLER_ID, user_id: SELLER_USER }],
      wallet_ledger: [],
    };
    const { admin, inserts } = createAdmin(tables);

    const forbidden = await collectMarketplaceOrderCash(admin, {
      actorUserId: CLIENT,
      orderId: ENTITY_ID,
    });
    assert.equal(forbidden.status, 403);

    const result = await collectMarketplaceOrderCash(admin, {
      actorUserId: SELLER_USER,
      orderId: ENTITY_ID,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.amount_gnf, 12500);
    assert.equal(tables.seller_orders[0].payment_status, "cash_collected");
    assert.equal(inserts[0].row.account_type, "seller");
    assert.equal(inserts[0].row.reference_id, ENTITY_ID);

    const again = await collectMarketplaceOrderCash(admin, {
      actorUserId: SELLER_USER,
      orderId: ENTITY_ID,
    });
    assert.equal(again.body.idempotent, true);
    assert.equal(inserts.length, 1);
  }

  // --- marketplace: orange_money / card orders are not cash --------------------
  {
    const tables: Record<string, Row[]> = {
      seller_orders: [
        {
          id: ENTITY_ID,
          seller_id: SELLER_ID,
          client_user_id: CLIENT,
          status: "ready",
          payment_status: "pending_cash",
          currency: "GNF",
          country_code: "GN",
          total_cents: 12500,
          checkout_shadow: { payment_method: "orange_money" },
        },
      ],
      sellers: [{ id: SELLER_ID, user_id: SELLER_USER }],
    };
    const { admin, updates } = createAdmin(tables);
    const result = await collectMarketplaceOrderCash(admin, {
      actorUserId: SELLER_USER,
      orderId: ENTITY_ID,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "not_cash");
    assert.equal(updates.length, 0);
  }

  console.log("guineaLocalCashCollect.test.ts OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
