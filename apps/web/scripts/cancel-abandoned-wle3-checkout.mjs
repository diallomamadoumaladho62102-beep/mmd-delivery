#!/usr/bin/env node
/**
 * Cancel unpaid Live Food order for abandoned Checkout Session cs_live_…wle3.
 * Attempts Stripe expire when sk_live_ is available.
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const ORDER_ID = "ad7cda0a-2201-41cf-a698-21ecefe26af8";
const SESSION_ID =
  "cs_live_b1T28pcPYWMg2FCKMh6uDPW2m8twYEGbnNAIlrZ5X3spBDEdU41HR3wle3";

function mask(value) {
  const text = String(value ?? "");
  if (!text) return null;
  if (text.length <= 12) return `${text.slice(0, 4)}…`;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function loadStripeLiveKey() {
  for (const file of [
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env"),
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env.local"),
  ]) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((l) => l.startsWith("STRIPE_SECRET_KEY="));
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
  return env.startsWith("sk_live_") ? env : null;
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

  const { data: before } = await admin
    .from("orders")
    .select(
      "id,payment_status,status,total_cents,currency,stripe_session_id,stripe_payment_intent_id",
    )
    .eq("id", ORDER_ID)
    .maybeSingle();

  const pay = String(before?.payment_status ?? "").toLowerCase();
  if (pay === "paid") {
    console.log(
      JSON.stringify({
        ok: false,
        error: "refusing_cancel_paid_order",
        order: mask(ORDER_ID),
      }),
    );
    process.exit(2);
  }

  const stripeKey = loadStripeLiveKey();
  let sessionExpire = {
    attempted: false,
    ok: false,
    status: null,
    error: null,
  };
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
    sessionExpire.error =
      json?.error?.message ?? (!res.ok ? `http_${res.status}` : null);
  } else {
    sessionExpire.error = "sk_live_unavailable_locally";
  }

  let orderCancel = { attempted: false, ok: false, error: null };
  if (
    before &&
    ["unpaid", "processing"].includes(pay) &&
    String(before.status ?? "").toLowerCase() !== "canceled"
  ) {
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
    .select("id,payment_status,status,total_cents")
    .eq("id", ORDER_ID)
    .maybeSingle();

  const abandoned = {
    abandoned_at: new Date().toISOString(),
    reason: "success_cancel_urls_used_vercel_app_domain",
    order_id_masked: mask(ORDER_ID),
    session_id_masked: mask(SESSION_ID),
    session_id_full_local_only: SESSION_ID,
    do_not_reuse_url: true,
    session_expire: sessionExpire,
    order_cancel: orderCancel,
    after: after
      ? { payment_status: after.payment_status, status: after.status }
      : null,
  };

  const outDir = join(__dirname, "..", ".tmp");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "abandoned-live-checkout-wle3.json"),
    JSON.stringify(abandoned, null, 2),
  );

  console.log(JSON.stringify(abandoned, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
