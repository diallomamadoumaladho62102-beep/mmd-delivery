#!/usr/bin/env node
/**
 * Cancel current unpaid Live Food order (no mark paid).
 * Optionally expire Checkout Session if sk_live_ is available.
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const ORDER_ID =
  process.env.CANCEL_ORDER_ID || "3bff6878-1652-4331-bd1c-e5e92f3501cb";
const SESSION_ID =
  process.env.CANCEL_SESSION_ID ||
  "cs_live_b1gsgEoumcaMjfNO1JU9QPxdRwHQWfPfdvy8y3kDYqseWWh3D7Efv23GIH";

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
  return env.startsWith("sk_live_") ? env : null;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !service) {
    console.log(JSON.stringify({ ok: false, error: "supabase_admin_missing" }));
    process.exit(1);
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const { data: before } = await admin
    .from("orders")
    .select(
      "id,payment_status,status,total,total_cents,currency,stripe_session_id,stripe_payment_intent_id,expires_at,created_at",
    )
    .eq("id", ORDER_ID)
    .maybeSingle();

  if (!before) {
    console.log(JSON.stringify({ ok: false, error: "order_not_found", order: mask(ORDER_ID) }));
    process.exit(1);
  }

  const pay = String(before.payment_status ?? "").toLowerCase();
  if (pay === "paid") {
    console.log(
      JSON.stringify({
        ok: false,
        error: "refusing_cancel_paid_order",
        order: mask(ORDER_ID),
        payment_status: before.payment_status,
      }),
    );
    process.exit(2);
  }

  const stripeKey = loadStripeLiveKey();
  let sessionInspect = { attempted: false, ok: false, data: null, error: null };
  let sessionExpire = { attempted: false, ok: false, status: null, error: null };

  if (stripeKey) {
    sessionInspect.attempted = true;
    const getRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(SESSION_ID)}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    );
    const getJson = await getRes.json().catch(() => ({}));
    if (getRes.ok) {
      sessionInspect.ok = true;
      sessionInspect.data = {
        status: getJson.status,
        payment_status: getJson.payment_status,
        livemode: getJson.livemode === true,
        amount_total: getJson.amount_total,
        currency: getJson.currency,
        expires_at: getJson.expires_at
          ? new Date(getJson.expires_at * 1000).toISOString()
          : null,
        url: getJson.url,
        payment_intent: getJson.payment_intent
          ? mask(String(getJson.payment_intent))
          : null,
        customer: getJson.customer ? mask(String(getJson.customer)) : null,
        success_url: getJson.success_url,
        cancel_url: getJson.cancel_url,
        payment_method_types: getJson.payment_method_types,
      };
    } else {
      sessionInspect.error = getJson?.error?.message ?? `http_${getRes.status}`;
    }

    if (getJson?.status === "open" || sessionInspect.error) {
      sessionExpire.attempted = true;
      const expRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(SESSION_ID)}/expire`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${stripeKey}` },
        },
      );
      const expJson = await expRes.json().catch(() => ({}));
      sessionExpire.ok = expRes.ok || expJson?.status === "expired";
      sessionExpire.status = expJson?.status ?? null;
      sessionExpire.error =
        expJson?.error?.message ?? (!expRes.ok ? `http_${expRes.status}` : null);
    }
  } else {
    sessionInspect.error = "sk_live_unavailable_locally";
    sessionExpire.error = "sk_live_unavailable_locally";
  }

  const canCancel =
    ["unpaid", "processing"].includes(pay) &&
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
    .select("id,payment_status,status,total_cents,currency,stripe_session_id")
    .eq("id", ORDER_ID)
    .maybeSingle();

  console.log(
    JSON.stringify(
      {
        order_id_masked: mask(ORDER_ID),
        session_id_masked: mask(SESSION_ID),
        before: {
          payment_status: before.payment_status,
          status: before.status,
          total_cents: before.total_cents,
          currency: before.currency,
          expires_at: before.expires_at,
          created_at: before.created_at,
          has_payment_intent: Boolean(before.stripe_payment_intent_id),
          session_matches:
            String(before.stripe_session_id || "") === SESSION_ID,
        },
        session_inspect: sessionInspect,
        session_expire: sessionExpire,
        order_cancel: orderCancel,
        after: after
          ? {
              payment_status: after.payment_status,
              status: after.status,
              total_cents: after.total_cents,
            }
          : null,
      },
      null,
      2,
    ),
  );

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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
