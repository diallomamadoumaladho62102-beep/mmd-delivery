#!/usr/bin/env node
/**
 * READ-ONLY inventory of E2E test artifacts tied to the test client account.
 * Never modifies anything. Never touches paid rows.
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "mmddelivery621@gmail.com";

function mask(v) {
  const t = String(v ?? "");
  if (!t) return null;
  return t.length <= 12 ? `${t.slice(0, 4)}…` : `${t.slice(0, 8)}…${t.slice(-4)}`;
}

async function resolveTestUserId(admin) {
  // Try auth admin listing (paginated) to find the email.
  try {
    let page = 1;
    for (; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const found = (data?.users ?? []).find(
        (u) => String(u.email ?? "").toLowerCase() === TEST_EMAIL.toLowerCase(),
      );
      if (found) return found.id;
      if (!data || (data.users ?? []).length < 200) break;
    }
  } catch {
    /* fall through */
  }
  // Fallback: profiles table lookup by email.
  for (const table of ["profiles", "clients", "users"]) {
    try {
      const { data } = await admin
        .from(table)
        .select("id,user_id,email")
        .eq("email", TEST_EMAIL)
        .maybeSingle();
      if (data) return data.user_id || data.id;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function safeQuery(admin, table, selectCols, filters) {
  try {
    let q = admin.from(table).select(selectCols);
    q = filters(q);
    const { data, error } = await q;
    if (error) return { table, error: error.message, rows: [] };
    return { table, rows: data ?? [] };
  } catch (e) {
    return { table, error: e instanceof Error ? e.message : String(e), rows: [] };
  }
}

function summarize(rows, statusField = "payment_status") {
  const byStatus = {};
  for (const r of rows) {
    const k = String(r[statusField] ?? "unknown").toLowerCase();
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  return byStatus;
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

  const testUserId = await resolveTestUserId(admin);
  if (!testUserId) {
    console.log(JSON.stringify({ ok: false, error: "test_user_not_found", email: TEST_EMAIL }));
    process.exit(1);
  }

  const report = { test_email: TEST_EMAIL, test_user_id_masked: mask(testUserId) };

  // ORDERS (food / delivery / errand share orders table via kind/order_type)
  const orders = await safeQuery(
    admin,
    "orders",
    "id,kind,order_type,status,payment_status,total,total_cents,currency,stripe_session_id,stripe_payment_intent_id,driver_id,created_at,restaurant_id",
    (q) =>
      q.or(
        `client_user_id.eq.${testUserId},created_by.eq.${testUserId},user_id.eq.${testUserId},client_id.eq.${testUserId}`,
      ),
  );
  report.orders = {
    error: orders.error ?? null,
    total: orders.rows.length,
    by_payment_status: summarize(orders.rows),
    paid_count: orders.rows.filter(
      (r) => String(r.payment_status ?? "").toLowerCase() === "paid",
    ).length,
    rows: orders.rows.map((r) => ({
      id_masked: mask(r.id),
      id_full: r.id,
      kind: r.kind ?? r.order_type ?? null,
      status: r.status,
      payment_status: r.payment_status,
      total: r.total,
      total_cents: r.total_cents,
      has_session: Boolean(r.stripe_session_id),
      session_masked: mask(r.stripe_session_id),
      has_pi: Boolean(r.stripe_payment_intent_id),
      driver_id: r.driver_id ? mask(r.driver_id) : null,
      created_at: r.created_at,
    })),
  };

  // DELIVERY REQUESTS
  const dreq = await safeQuery(
    admin,
    "delivery_requests",
    "id,status,payment_status,total,total_cents,currency,stripe_session_id,stripe_payment_intent_id,created_at",
    (q) => q.or(`client_user_id.eq.${testUserId},created_by.eq.${testUserId}`),
  );
  report.delivery_requests = {
    error: dreq.error ?? null,
    total: dreq.rows.length,
    by_payment_status: summarize(dreq.rows),
    paid_count: dreq.rows.filter(
      (r) => String(r.payment_status ?? "").toLowerCase() === "paid",
    ).length,
    rows: dreq.rows.map((r) => ({
      id_masked: mask(r.id),
      id_full: r.id,
      status: r.status,
      payment_status: r.payment_status,
      total: r.total,
      has_session: Boolean(r.stripe_session_id),
      created_at: r.created_at,
    })),
  };

  // TAXI RIDES
  const taxi = await safeQuery(
    admin,
    "taxi_rides",
    "id,status,payment_status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,created_at",
    (q) => q.eq("client_user_id", testUserId),
  );
  report.taxi_rides = {
    error: taxi.error ?? null,
    total: taxi.rows.length,
    by_payment_status: summarize(taxi.rows),
    paid_count: taxi.rows.filter(
      (r) => String(r.payment_status ?? "").toLowerCase() === "paid",
    ).length,
    rows: taxi.rows.map((r) => ({
      id_masked: mask(r.id),
      id_full: r.id,
      status: r.status,
      payment_status: r.payment_status,
      total_cents: r.total_cents,
      has_session: Boolean(r.stripe_session_id),
      created_at: r.created_at,
    })),
  };

  // MARKETPLACE seller_orders
  for (const col of ["client_user_id", "buyer_id", "buyer_user_id", "created_by"]) {
    const mk = await safeQuery(
      admin,
      "seller_orders",
      "id,status,payment_status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,created_at",
      (q) => q.eq(col, testUserId),
    );
    if (!mk.error) {
      report.seller_orders = {
        matched_column: col,
        total: mk.rows.length,
        by_payment_status: summarize(mk.rows),
        paid_count: mk.rows.filter(
          (r) => String(r.payment_status ?? "").toLowerCase() === "paid",
        ).length,
        rows: mk.rows.map((r) => ({
          id_masked: mask(r.id),
          id_full: r.id,
          status: r.status,
          payment_status: r.payment_status,
          has_session: Boolean(r.stripe_session_id),
          created_at: r.created_at,
        })),
      };
      break;
    }
    report.seller_orders = { error: mk.error };
  }

  // DISPATCH schedules/attempts tied to test order ids
  const orderIds = orders.rows.map((r) => r.id);
  if (orderIds.length) {
    const sched = await safeQuery(
      admin,
      "order_dispatch_wave_schedule",
      "id,order_id,status,run_at,next_wave",
      (q) => q.in("order_id", orderIds),
    );
    report.order_dispatch_wave_schedule = {
      error: sched.error ?? null,
      total: sched.rows.length,
      by_status: summarize(sched.rows, "status"),
    };
    const att = await safeQuery(
      admin,
      "order_dispatch_attempts",
      "id,order_id,created_at",
      (q) => q.in("order_id", orderIds),
    );
    report.order_dispatch_attempts = {
      error: att.error ?? null,
      total: att.rows.length,
    };
  }

  // Open Stripe sessions among test orders (read via pk_live payment_pages if available)
  report.open_test_sessions = orders.rows
    .filter(
      (r) =>
        r.stripe_session_id &&
        String(r.payment_status ?? "").toLowerCase() !== "paid",
    )
    .map((r) => ({
      order_masked: mask(r.id),
      session_masked: mask(r.stripe_session_id),
      payment_status: r.payment_status,
    }));

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
