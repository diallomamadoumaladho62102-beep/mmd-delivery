/**
 * Controlled post-payment audit + kitchen/delivery simulation for ONE order.
 * - No new Stripe charge
 * - No refund
 * - No payout / transfer
 * - No mobile build / OTA
 *
 *   node --env-file=.env.local scripts/audit-food-order-3705-flow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORDER_ID = "3705c677-7fad-498c-b312-14035321ee2f";
const RESTAURANT_ID = "b92dfca2-32f4-424a-bc1b-8f3d9666f565";
const PI = "pi_3TusjCA5Qa1Y9XYr0dO78Yxu";
const DEDUP = `restaurant_new_order:${ORDER_ID}`;

const url = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const report = {
  orderId: ORDER_ID,
  startedAt: new Date().toISOString(),
  steps: [],
  checks: {},
  final: null,
};

function logStep(name, detail) {
  const entry = { name, at: new Date().toISOString(), ...detail };
  report.steps.push(entry);
  console.log(`STEP ${name}`, JSON.stringify(detail));
}

async function sb(method, pathAndQuery, body) {
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers:
      method === "GET"
        ? headers
        : { ...headers, Prefer: "return=representation" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${pathAndQuery} -> ${res.status} ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function getOrder() {
  const rows = await sb(
    "GET",
    `orders?id=eq.${ORDER_ID}&select=id,status,payment_status,kind,restaurant_id,restaurant_user_id,restaurant_name,total_cents,stripe_payment_intent_id,paid_at,created_at,restaurant_accept_expires_at,restaurant_prepared_at,ready_at,driver_id,picked_up_at,delivered_at,delivered_confirmed_at,auto_accepted,pickup_code,dropoff_code,driver_paid_out,restaurant_paid_out`,
  );
  return rows?.[0] ?? null;
}

async function insertEvent(eventType, oldStatus, newStatus, note) {
  try {
    await sb("POST", "order_events", {
      order_id: ORDER_ID,
      event_type: eventType,
      old_status: oldStatus,
      new_status: newStatus,
      note: note ?? "audit-food-order-3705-flow",
      actor_id: RESTAURANT_ID,
      triggered_by: RESTAURANT_ID,
      triggered_role: "system",
      description: note ?? eventType,
      metadata: { source: "audit-food-order-3705-flow", at: new Date().toISOString() },
    });
  } catch (e) {
    logStep("order_event_insert_warn", { eventType, error: String(e.message ?? e) });
  }
}

async function patchOrder(payload, expectedStatus) {
  let q = `orders?id=eq.${ORDER_ID}&kind=eq.food&payment_status=eq.paid`;
  if (expectedStatus) q += `&status=eq.${expectedStatus}`;
  return sb("PATCH", q, payload);
}

async function main() {
  const before = await getOrder();
  report.checks.orderBefore = before;
  logStep("order_loaded", {
    status: before?.status,
    payment_status: before?.payment_status,
    restaurant_user_id: before?.restaurant_user_id,
    restaurant_name: before?.restaurant_name,
    pi: before?.stripe_payment_intent_id,
    total_cents: before?.total_cents,
  });

  if (!before) throw new Error("order_not_found");
  if (before.payment_status !== "paid") throw new Error("order_not_paid");
  if (before.restaurant_user_id !== RESTAURANT_ID) {
    throw new Error("restaurant_mismatch");
  }
  if (before.stripe_payment_intent_id !== PI) throw new Error("pi_mismatch");

  // Finance (idempotency key is the stable lookup; entity_id may not exist in prod)
  const financeEvents = await sb(
    "GET",
    `finance_source_events?idempotency_key=eq.${encodeURIComponent(
      `finance:payment:food:${ORDER_ID}:${PI}`,
    )}&select=id,event_type,status,idempotency_key,journal_entry_id&order=created_at.asc`,
  );
  const foodPaid = (financeEvents ?? []).filter(
    (e) => String(e.event_type).toLowerCase() === "food_paid",
  );
  report.checks.finance = {
    food_paid_count: foodPaid.length,
    food_paid: foodPaid,
  };
  logStep("finance", report.checks.finance);

  // Commissions
  const commissions = await sb(
    "GET",
    `order_commissions?order_id=eq.${ORDER_ID}&select=*`,
  );
  report.checks.commissions = {
    count: (commissions ?? []).length,
    row: commissions?.[0]
      ? {
          restaurant_cents: commissions[0].restaurant_cents,
          driver_cents: commissions[0].driver_cents,
          platform_cents: commissions[0].platform_cents,
          client_cents: commissions[0].client_cents,
          restaurant_release_status: commissions[0].restaurant_release_status,
          driver_release_status: commissions[0].driver_release_status,
        }
      : null,
  };
  logStep("commissions", report.checks.commissions);

  // Push logs + dedup
  const notifLogs = await sb(
    "GET",
    `notification_logs?dedup_key=eq.${encodeURIComponent(DEDUP)}&select=id,status,user_id,error_message,created_at,sent_at&order=created_at.desc`,
  );
  const sentLogs = (notifLogs ?? []).filter((l) => l.status === "sent");
  report.checks.notifications = {
    dedup_key: DEDUP,
    total: (notifLogs ?? []).length,
    sent: sentLogs.length,
    user_id: sentLogs[0]?.user_id ?? null,
    latest: notifLogs?.[0] ?? null,
  };
  logStep("notifications", report.checks.notifications);

  // Tokens (prefix only)
  const tokens = await sb(
    "GET",
    `user_push_tokens?user_id=eq.${RESTAURANT_ID}&role=eq.restaurant&select=platform,expo_push_token,updated_at`,
  );
  const uniqueTokens = new Set(
    (tokens ?? []).map((t) => String(t.expo_push_token ?? "").trim()).filter(Boolean),
  );
  report.checks.tokens = {
    rows: (tokens ?? []).length,
    unique: uniqueTokens.size,
    platforms: [...new Set((tokens ?? []).map((t) => t.platform))],
    latest_updated_at: (tokens ?? [])
      .map((t) => t.updated_at)
      .sort()
      .at(-1),
  };
  logStep("tokens", report.checks.tokens);

  // Loyalty before (table public.loyalty_ledger)
  let loyaltyBefore = [];
  try {
    loyaltyBefore = await sb(
      "GET",
      `loyalty_ledger?reference_id=eq.${ORDER_ID}&select=id,points,entry_type,created_at`,
    );
  } catch (e1) {
    try {
      loyaltyBefore = await sb(
        "GET",
        `loyalty_ledger?select=id,points,created_at&reference_id=eq.${ORDER_ID}`,
      );
    } catch (e2) {
      loyaltyBefore = { error: String(e2.message ?? e1.message ?? e2) };
    }
  }
  report.checks.loyaltyBefore = loyaltyBefore;
  logStep("loyalty_before", { loyaltyBefore });

  // Payouts must stay locked / zero
  const payouts = await sb(
    "GET",
    `order_payouts?order_id=eq.${ORDER_ID}&select=id,status,target,amount_cents`,
  ).catch(() => []);
  report.checks.payoutsBefore = payouts;
  if ((payouts ?? []).length > 0) {
    throw new Error("unexpected_existing_payouts");
  }

  // --- Controlled kitchen transitions (no Stripe, no payout) ---
  const now = new Date();
  const acceptExpires = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  if (String(before.status).toLowerCase() === "pending") {
    await patchOrder(
      { restaurant_accept_expires_at: acceptExpires },
      "pending",
    );
    logStep("accept_window_extended", { restaurant_accept_expires_at: acceptExpires });

    // Prefer status-only accept (compatible with prod missing accepted_at cols).
    await patchOrder(
      { status: "accepted", updated_at: now.toISOString() },
      "pending",
    );
    await insertEvent(
      "restaurant_accept",
      "pending",
      "accepted",
      "Audit controlled accept (no payout)",
    );
    logStep("accepted", { status: "accepted" });
  }

  let cur = await getOrder();
  if (String(cur.status).toLowerCase() === "accepted") {
    await patchOrder(
      {
        status: "prepared",
        restaurant_prepared_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      "accepted",
    );
    await insertEvent(
      "restaurant_prepared",
      "accepted",
      "prepared",
      "Audit controlled prepare",
    );
    logStep("prepared", { status: "prepared" });
  }

  cur = await getOrder();
  if (String(cur.status).toLowerCase() === "prepared") {
    await patchOrder(
      {
        status: "ready",
        ready_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      "prepared",
    );
    await insertEvent(
      "restaurant_ready",
      "prepared",
      "ready",
      "Audit controlled ready (dispatch not auto-fired; no payout)",
    );
    logStep("ready", {
      status: "ready",
      note: "Smart dispatch not invoked here to avoid live driver spam; status ready verified.",
    });
  }

  // Controlled driver phase without payouts / without inventing a driver_id.
  // Valid FK statuses: pending→accepted→prepared→ready→assigned→dispatched→picked_up→delivered
  cur = await getOrder();
  const st = () => String(cur.status ?? "").toLowerCase();

  if (st() === "ready") {
    await patchOrder(
      { status: "assigned", updated_at: new Date().toISOString() },
      "ready",
    );
    await insertEvent(
      "driver_assigned",
      "ready",
      "assigned",
      "Audit controlled assign placeholder (no live dispatch spam)",
    );
    logStep("assigned", { status: "assigned", driver_id: null });
    cur = await getOrder();
  }

  if (st() === "assigned") {
    await patchOrder(
      { status: "dispatched", updated_at: new Date().toISOString() },
      "assigned",
    );
    await insertEvent(
      "driver_dispatched",
      "assigned",
      "dispatched",
      "Audit controlled dispatch status",
    );
    logStep("dispatched", { status: "dispatched" });
    cur = await getOrder();
  }

  if (st() === "dispatched" || st() === "ready") {
    await patchOrder(
      {
        status: "picked_up",
        picked_up_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      cur.status,
    );
    await insertEvent(
      "pickup_confirm",
      cur.status,
      "picked_up",
      "Audit controlled pickup (no payout)",
    );
    logStep("picked_up", { status: "picked_up", driver_id: cur.driver_id });
    cur = await getOrder();
  }

  if (st() === "picked_up") {
    await patchOrder(
      {
        status: "delivered",
        delivered_at: new Date().toISOString(),
        delivered_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      "picked_up",
    );
    await insertEvent(
      "delivery_confirm",
      "picked_up",
      "delivered",
      "Audit controlled delivery WITHOUT payout trigger",
    );
    logStep("delivered", {
      status: "delivered",
      payouts_triggered: false,
    });
  }

  // Loyalty accrual at delivery time (rule), without payouts
  const loyaltyRpc = await rpc("mmd_accrue_food_order", { p_order_id: ORDER_ID });
  report.checks.loyaltyRpc = {
    ok: loyaltyRpc.ok,
    status: loyaltyRpc.status,
    data: loyaltyRpc.data,
  };
  logStep("loyalty_accrue", report.checks.loyaltyRpc);

  // Restaurant performance hook if present
  const restPerf = await rpc("mmd_restaurant_on_order_completed", {
    p_order_id: ORDER_ID,
  }).catch((e) => ({ ok: false, error: String(e.message ?? e) }));
  report.checks.restaurantPerformanceRpc = restPerf;
  logStep("restaurant_performance", {
    ok: restPerf.ok,
    status: restPerf.status,
    data: restPerf.data,
  });

  // Idempotent finance check after simulation
  const financeAfter = await sb(
    "GET",
    `finance_source_events?idempotency_key=eq.${encodeURIComponent(
      `finance:payment:food:${ORDER_ID}:${PI}`,
    )}&select=id,event_type,status,idempotency_key`,
  );
  report.checks.financeAfter = {
    food_paid_rows: (financeAfter ?? []).length,
    rows: financeAfter,
  };

  const payoutsAfter = await sb(
    "GET",
    `order_payouts?order_id=eq.${ORDER_ID}&select=id,status,target`,
  ).catch(() => []);
  report.checks.payoutsAfter = payoutsAfter;

  const notifAfter = await sb(
    "GET",
    `notification_logs?dedup_key=eq.${encodeURIComponent(DEDUP)}&select=id,status&order=created_at.desc`,
  );
  report.checks.notificationsAfter = {
    total: (notifAfter ?? []).length,
    sent: (notifAfter ?? []).filter((l) => l.status === "sent").length,
  };

  // Dedup probe: call notify path would skip — we only re-check sent count == 1
  const after = await getOrder();
  report.final = {
    order: after,
    verdictBackend: null,
  };

  const blockers = [];
  if (after?.payment_status !== "paid") blockers.push("payment_status_not_paid");
  if (after?.status !== "delivered") blockers.push(`status_is_${after?.status}`);
  if (report.checks.finance.food_paid_count !== 1) {
    blockers.push(`food_paid_count_${report.checks.finance.food_paid_count}`);
  }
  if ((payoutsAfter ?? []).length > 0) blockers.push("payouts_created_unexpectedly");
  if (report.checks.notifications.sent < 1) blockers.push("restaurant_push_missing");
  if (report.checks.notifications.sent > 1) blockers.push("restaurant_push_duplicated");
  if (after?.driver_paid_out === true || after?.restaurant_paid_out === true) {
    blockers.push("payout_flags_set");
  }

  report.final.blockers = blockers;
  report.final.verdictBackend =
    blockers.length === 0 ? "READY" : "BLOCKED";
  report.finishedAt = new Date().toISOString();

  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../backups/live-pay-audit-3705",
  );
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "FLOW_AUDIT_REPORT.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log("WROTE", outFile);
  console.log("VERDICT_BACKEND", report.final.verdictBackend, blockers);
}

main().catch((e) => {
  console.error(e);
  report.final = { verdictBackend: "BLOCKED", error: String(e.message ?? e) };
  try {
    const outDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../backups/live-pay-audit-3705",
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "FLOW_AUDIT_REPORT.json"),
      JSON.stringify(report, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
