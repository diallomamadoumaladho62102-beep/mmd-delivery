#!/usr/bin/env node
/**
 * Targeted cleanup of internal Package $4.56 test order only.
 * NEVER deletes by broad filter — only the explicit ORDER_ID after verification.
 *
 * Usage:
 *   node scripts/cleanup-package-test-order-456.mjs           # dry-run probe
 *   node scripts/cleanup-package-test-order-456.mjs --apply   # delete verified test rows
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ws from "ws";

const require = createRequire(import.meta.url);
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

/** Internal test order from probe-package-456 — do not change without founder approval. */
const ORDER_ID = "81d96b94-53ca-451c-b7bc-f9dc68d39458";
const EXPECTED_DELIVERY_REQUEST_ID = "4aac2906-ad6b-4acf-83fe-7806917961a2";
const EXPECTED_DRIVER_PAYOUT_DOLLARS = 4.56;
const EXPECTED_DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";

function loadEnv() {
  for (const name of [".env.local", ".env", "apps/web/.env.local"]) {
    const p = path.join(repoRoot, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

if (!url || !key) {
  console.error(JSON.stringify({ ok: false, error: "missing_supabase_env" }));
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

async function maybeRows(table, filterFn) {
  try {
    let q = sb.from(table).select("*");
    q = filterFn(q);
    const { data, error } = await q;
    if (error?.code === "42P01") return { rows: [], skipped: true };
    if (error) return { rows: [], error: error.message };
    return { rows: data ?? [] };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function delRows(table, column, values) {
  if (!values.length) return { table, deleted: 0, skipped: true };
  const { data, error } = await sb
    .from(table)
    .delete()
    .in(column, values)
    .select("id");
  if (error) return { table, deleted: 0, error: error.message };
  return { table, deleted: (data ?? []).length };
}

async function main() {
  const { data: order, error: orderErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", ORDER_ID)
    .maybeSingle();

  if (orderErr) {
    console.error(JSON.stringify({ ok: false, error: orderErr.message }));
    process.exit(1);
  }
  if (!order) {
    console.log(
      JSON.stringify({
        ok: true,
        already_clean: true,
        message: "order_not_found",
        order_id: ORDER_ID,
      }, null, 2),
    );
    return;
  }

  const payout = Number(order.driver_delivery_payout ?? 0);
  const drId = String(order.external_ref_id ?? "");
  const driverId = String(order.driver_id ?? "");
  const pi = String(order.stripe_payment_intent_id ?? "");
  const hasTransfer = Boolean(order.driver_transfer_id);

  const checks = {
    payout_matches_456: Math.abs(payout - EXPECTED_DRIVER_PAYOUT_DOLLARS) < 0.02,
    delivery_request_matches: drId === EXPECTED_DELIVERY_REQUEST_ID,
    driver_matches: driverId === EXPECTED_DRIVER_ID,
    external_ref_type_delivery:
      String(order.external_ref_type ?? "") === "delivery_request",
    no_driver_transfer: !hasTransfer,
  };

  const verified = Object.values(checks).every(Boolean);
  if (!verified) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "verification_failed_refusing_delete",
          order_id: ORDER_ID,
          checks,
          order_summary: {
            driver_delivery_payout: payout,
            external_ref_id: drId,
            driver_id: driverId,
            driver_transfer_id: order.driver_transfer_id,
            payment_status: order.payment_status,
            stripe_payment_intent_id: pi,
          },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const drRes = drId
    ? await maybeRows("delivery_requests", (q) => q.eq("id", drId))
    : { rows: [] };
  const commRes = await maybeRows("order_commissions", (q) =>
    q.eq("order_id", ORDER_ID),
  );
  const payoutRes = await maybeRows("order_payouts", (q) =>
    q.eq("order_id", ORDER_ID),
  );
  const ptxRes = await maybeRows("payment_transactions", (q) =>
    q.or(`order_id.eq.${ORDER_ID},entity_id.eq.${ORDER_ID}`),
  );
  const eventsRes = await maybeRows("order_events", (q) =>
    q.eq("order_id", ORDER_ID),
  );
  const dispatchRes = await maybeRows("driver_dispatch_notifications", (q) =>
    q.eq("order_id", ORDER_ID),
  );
  const walletRes = await maybeRows("wallet_ledger", (q) =>
    q.eq("reference_id", ORDER_ID),
  );
  const mktJobRes = await maybeRows("marketplace_delivery_jobs", (q) =>
    q.eq("order_id", ORDER_ID),
  );

  const probe = {
    ok: true,
    apply: APPLY,
    verified_test_order: true,
    order: {
      id: order.id,
      status: order.status,
      payment_status: order.payment_status,
      driver_delivery_payout: payout,
      driver_transfer_id: order.driver_transfer_id,
      stripe_payment_intent_id: pi,
      external_ref_id: drId,
      created_at: order.created_at,
    },
    related: {
      delivery_requests: drRes.rows.length,
      order_commissions: commRes.rows.length,
      order_payouts: payoutRes.rows.length,
      payment_transactions: ptxRes.rows.length,
      order_events: eventsRes.rows.length,
      driver_dispatch_notifications: dispatchRes.rows.length,
      wallet_ledger: walletRes.rows.length,
      marketplace_delivery_jobs: mktJobRes.rows.length,
    },
    stripe_note:
      "Stripe PI/charge not deleted here — test row removed from DB only; no SCT was executed.",
  };

  if (!APPLY) {
    console.log(JSON.stringify({ dry_run: true, ...probe }, null, 2));
    return;
  }

  const results = [];
  const ptxIds = ptxRes.rows.map((r) => r.id).filter(Boolean);
  const payoutIds = payoutRes.rows.map((r) => r.id).filter(Boolean);

  results.push(await delRows("wallet_ledger", "reference_id", ptxIds));
  results.push(await delRows("wallet_ledger", "reference_id", [ORDER_ID]));
  results.push(await delRows("wallet_ledger", "reference_id", payoutIds));
  results.push(await delRows("order_events", "order_id", [ORDER_ID]));
  results.push(
    await delRows("driver_dispatch_notifications", "order_id", [ORDER_ID]),
  );
  results.push(await delRows("payment_transactions", "id", ptxIds));
  results.push(await delRows("order_commissions", "order_id", [ORDER_ID]));
  results.push(await delRows("order_payouts", "order_id", [ORDER_ID]));
  // marketplace_delivery_jobs links via delivery_request_id, not order_id — skip if absent
  results.push(await delRows("orders", "id", [ORDER_ID]));
  if (drId) {
    results.push(await delRows("delivery_requests", "id", [drId]));
  }

  const { data: gone } = await sb
    .from("orders")
    .select("id")
    .eq("id", ORDER_ID)
    .maybeSingle();

  console.log(
    JSON.stringify(
      {
        applied: true,
        ...probe,
        results,
        order_still_exists: Boolean(gone),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
