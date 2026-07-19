#!/usr/bin/env node
/**
 * FULL hard-delete cleanup of Stripe TEST + unpaid Live E2E artifacts tied to
 * the test client account. Refuses to touch any row that is LIVE + paid.
 *
 * Order of deletion: ledger/derived children first, then parents (FK cascade
 * handles the rest).
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "mmddelivery621@gmail.com";
const APPLY = process.argv.includes("--apply");

function mask(v) {
  const t = String(v ?? "");
  if (!t) return null;
  return t.length <= 12 ? `${t.slice(0, 4)}…` : `${t.slice(0, 8)}…${t.slice(-4)}`;
}

/** Guard: never delete a row that represents a real LIVE payment. */
function isProtectedLivePaid(row) {
  const pay = String(row.payment_status ?? "").toLowerCase();
  const session = String(row.stripe_session_id ?? "");
  const pi = String(row.stripe_payment_intent_id ?? "");
  if (pay !== "paid") return false;
  return session.startsWith("cs_live_") || pi.startsWith("pi_live_");
}

async function resolveTestUserId(admin) {
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const found = (data?.users ?? []).find(
        (u) => String(u.email ?? "").toLowerCase() === TEST_EMAIL.toLowerCase(),
      );
      if (found) return found.id;
      if ((data?.users ?? []).length < 200) break;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function collectIds(admin, table, cols, filter) {
  try {
    let q = admin.from(table).select(cols);
    q = filter(q);
    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    return { rows: data ?? [], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function delIn(admin, table, column, values) {
  if (!values.length) return { table, column, deleted: 0, skipped: true };
  try {
    const { data, error } = await admin
      .from(table)
      .delete()
      .in(column, values)
      .select("id");
    if (error) return { table, column, deleted: 0, error: error.message };
    return { table, column, deleted: (data ?? []).length };
  } catch (e) {
    return {
      table,
      column,
      deleted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const userId = await resolveTestUserId(admin);
  if (!userId) {
    console.log(JSON.stringify({ ok: false, error: "test_user_not_found" }));
    process.exit(1);
  }

  // ---- Collect parents ----
  const ordersRes = await collectIds(
    admin,
    "orders",
    "id,payment_status,stripe_session_id,stripe_payment_intent_id",
    (q) =>
      q.or(
        `client_user_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId},client_id.eq.${userId}`,
      ),
  );
  const dreqRes = await collectIds(
    admin,
    "delivery_requests",
    "id,payment_status,stripe_session_id,stripe_payment_intent_id",
    (q) => q.or(`client_user_id.eq.${userId},created_by.eq.${userId}`),
  );
  const taxiRes = await collectIds(
    admin,
    "taxi_rides",
    "id,payment_status,stripe_session_id,stripe_payment_intent_id",
    (q) => q.eq("client_user_id", userId),
  );
  let sellerRes = { rows: [], error: null };
  for (const col of ["client_user_id", "buyer_id", "buyer_user_id", "created_by"]) {
    const r = await collectIds(admin, "seller_orders", "id,payment_status", (q) =>
      q.eq(col, userId),
    );
    if (!r.error) {
      sellerRes = r;
      break;
    }
    sellerRes = r;
  }

  const protectedRows = [];
  function keep(rows) {
    return rows.filter((r) => {
      if (isProtectedLivePaid(r)) {
        protectedRows.push({ id: mask(r.id), payment_status: r.payment_status });
        return false;
      }
      return true;
    });
  }

  const orderRows = keep(ordersRes.rows);
  const dreqRows = keep(dreqRes.rows);
  const taxiRows = keep(taxiRes.rows);
  const sellerRows = keep(sellerRes.rows);

  const orderIds = orderRows.map((r) => r.id);
  const dreqIds = dreqRows.map((r) => r.id);
  const taxiIds = taxiRows.map((r) => r.id);
  const sellerIds = sellerRows.map((r) => r.id);
  const allEntityIds = [...orderIds, ...dreqIds, ...taxiIds, ...sellerIds];

  // ---- Collect derived ids (payment_transactions, order_payouts) ----
  const ptxRes = await collectIds(admin, "payment_transactions", "id,order_id,entity_id", (q) =>
    q.or(
      `order_id.in.(${orderIds.join(",") || "00000000-0000-0000-0000-000000000000"}),entity_id.in.(${allEntityIds.join(",") || "00000000-0000-0000-0000-000000000000"})`,
    ),
  );
  const ptxIds = ptxRes.rows.map((r) => r.id);

  const payoutRes = await collectIds(admin, "order_payouts", "id,order_id", (q) =>
    q.in("order_id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]),
  );
  const payoutIds = payoutRes.rows.map((r) => r.id);

  const plan = {
    apply: APPLY,
    test_user_masked: mask(userId),
    counts: {
      orders: orderIds.length,
      delivery_requests: dreqIds.length,
      taxi_rides: taxiIds.length,
      seller_orders: sellerIds.length,
      payment_transactions: ptxIds.length,
      order_payouts: payoutIds.length,
    },
    protected_live_paid: protectedRows,
  };

  if (!APPLY) {
    console.log(JSON.stringify({ dry_run: true, ...plan }, null, 2));
    return;
  }

  const results = [];

  // 1) wallet_ledger (no FK cascade): payment_transaction + commission (order) + order_payout refs
  results.push(await delIn(admin, "wallet_ledger", "reference_id", ptxIds));
  results.push(await delIn(admin, "wallet_ledger", "reference_id", orderIds)); // commission
  results.push(await delIn(admin, "wallet_ledger", "reference_id", payoutIds)); // order_payout

  // 2) taxi_loyalty_ledger (set null on ride delete, but remove test entries)
  results.push(await delIn(admin, "taxi_loyalty_ledger", "taxi_ride_id", taxiIds));

  // 3) order_events (order_id not FK -> no cascade)
  results.push(await delIn(admin, "order_events", "order_id", orderIds));

  // 4) dispatch notifications (soft link)
  results.push(await delIn(admin, "driver_dispatch_notifications", "order_id", orderIds));

  // 5) payment_transactions (order_id set null; delete explicitly)
  results.push(await delIn(admin, "payment_transactions", "id", ptxIds));

  // 6) parents (FK cascade removes order_items, commissions, payouts, offers,
  //    dispatch_attempts/schedule, taxi_* children, seller_order_items,
  //    marketplace_delivery_jobs + payouts, delivery_request_driver_offers)
  results.push(await delIn(admin, "seller_orders", "id", sellerIds));
  results.push(await delIn(admin, "taxi_rides", "id", taxiIds));
  results.push(await delIn(admin, "delivery_requests", "id", dreqIds));
  results.push(await delIn(admin, "orders", "id", orderIds));

  console.log(JSON.stringify({ applied: true, ...plan, results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
