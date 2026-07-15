#!/usr/bin/env node
/**
 * Expire the incorrect Live Food Checkout Session and cancel the unpaid order.
 * Does not mark paid. Does not print secrets.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const ORDER_ID = "fa17bd9c-dbf5-46dd-884d-c283f38e14b3";
const SESSION_ID =
  "cs_live_b1GfJRaUEUMuhcDaQeI3QkS9y9Pq0gi3maLzvzpn9KuohezuvzUioN12Zn";

function loadStripeLiveKey() {
  const candidates = [
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env"),
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env.local"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("STRIPE_SECRET_KEY="));
    if (!line) continue;
    let value = line.slice("STRIPE_SECRET_KEY=".length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("sk_live_")) return value;
  }
  const env = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (env.startsWith("sk_live_")) return env;
  return null;
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

  const stripeKey = loadStripeLiveKey();
  let sessionExpire = { attempted: false, ok: false, status: null, error: null };
  if (stripeKey) {
    sessionExpire.attempted = true;
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(SESSION_ID)}/expire`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}` },
      },
    );
    const json = await res.json().catch(() => ({}));
    sessionExpire.ok = res.ok || json?.status === "expired";
    sessionExpire.status = json?.status ?? null;
    sessionExpire.error = json?.error?.message ?? (!res.ok ? `http_${res.status}` : null);
  } else {
    sessionExpire.error = "sk_live_unavailable_locally";
  }

  const { data: before } = await admin
    .from("orders")
    .select("id, payment_status, status, stripe_session_id, total, delivery_fee")
    .eq("id", ORDER_ID)
    .maybeSingle();

  const canCancel =
    before &&
    ["unpaid", "processing"].includes(String(before.payment_status ?? "").toLowerCase()) &&
    String(before.status ?? "").toLowerCase() !== "canceled";

  let orderCancel = { attempted: false, ok: false, error: null };
  if (canCancel) {
    orderCancel.attempted = true;
    const { error } = await admin
      .from("orders")
      .update({
        status: "canceled",
        payment_status: "unpaid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", ORDER_ID)
      .in("payment_status", ["unpaid", "processing"]);
    orderCancel.ok = !error;
    orderCancel.error = error?.message ?? null;
  }

  const { data: after } = await admin
    .from("orders")
    .select("id, payment_status, status, delivery_fee, total")
    .eq("id", ORDER_ID)
    .maybeSingle();

  console.log(
    JSON.stringify(
      {
        order_id_masked: `${ORDER_ID.slice(0, 8)}…${ORDER_ID.slice(-4)}`,
        session_id_masked: `${SESSION_ID.slice(0, 10)}…${SESSION_ID.slice(-4)}`,
        before: before
          ? {
              payment_status: before.payment_status,
              status: before.status,
              delivery_fee: before.delivery_fee,
              total: before.total,
            }
          : null,
        session_expire: sessionExpire,
        order_cancel: orderCancel,
        after: after
          ? {
              payment_status: after.payment_status,
              status: after.status,
              delivery_fee: after.delivery_fee,
              total: after.total,
            }
          : null,
      },
      null,
      2,
    ),
  );

  // Never leave pulled secrets around.
  for (const file of [
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env"),
  ]) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
