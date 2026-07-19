#!/usr/bin/env node
/**
 * Inspect a Live Checkout Session via Stripe API.
 * Prints no secret keys. Requires STRIPE_SECRET_KEY in env (sk_live_).
 */
import { createRequire } from "node:module";
import ws from "ws";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: "apps/web/.env.local" });
  require("dotenv").config({ path: ".tmp/vercel-prod.env" });
} catch {
  /* optional */
}

const SESSION_ID =
  process.env.INSPECT_SESSION_ID ||
  "cs_live_b1gsgEoumcaMjfNO1JU9QPxdRwHQWfPfdvy8y3kDYqseWWh3D7Efv23GIH";
const ORDER_ID =
  process.env.INSPECT_ORDER_ID || "3bff6878-1652-4331-bd1c-e5e92f3501cb";

function mask(value) {
  const text = String(value ?? "");
  if (!text) return null;
  if (text.length <= 12) return `${text.slice(0, 4)}…`;
  return `${text.slice(0, 10)}…${text.slice(-4)}`;
}

async function main() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  const mode = key.startsWith("sk_live_")
    ? "live"
    : key.startsWith("sk_test_")
      ? "test"
      : key
        ? "other"
        : "missing";
  console.log(JSON.stringify({ stripe_key_mode: mode, session_id_masked: mask(SESSION_ID) }));

  if (mode !== "live") {
    console.log(JSON.stringify({ ok: false, error: "sk_live_required_to_inspect_live_session" }));
    process.exit(2);
  }

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(SESSION_ID)}?expand[]=payment_intent`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const session = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          http: res.status,
          error: session?.error?.message ?? session?.error ?? "retrieve_failed",
          code: session?.error?.code ?? null,
          type: session?.error?.type ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const pi = session.payment_intent;
  const out = {
    ok: true,
    id_masked: mask(session.id),
    status: session.status,
    payment_status: session.payment_status,
    livemode: session.livemode === true,
    amount_total: session.amount_total,
    currency: session.currency,
    expires_at: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null,
    expires_at_unix: session.expires_at ?? null,
    url: session.url,
    success_url: session.success_url,
    cancel_url: session.cancel_url,
    customer: session.customer ? mask(session.customer) : null,
    payment_intent: pi
      ? typeof pi === "string"
        ? { id_masked: mask(pi) }
        : {
            id_masked: mask(pi.id),
            status: pi.status,
            amount: pi.amount,
            currency: pi.currency,
          }
      : null,
    payment_method_types: session.payment_method_types ?? null,
    mode: session.mode,
    client_reference_id_masked: mask(session.client_reference_id),
    metadata: session.metadata ?? null,
    created: session.created
      ? new Date(session.created * 1000).toISOString()
      : null,
  };
  console.log(JSON.stringify(out, null, 2));

  // Also confirm DB order still unpaid/processing.
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false }, realtime: { transport: ws } },
  );
  const { data: order } = await admin
    .from("orders")
    .select("id,status,payment_status,total_cents,currency,stripe_session_id")
    .eq("id", ORDER_ID)
    .maybeSingle();
  console.log(
    JSON.stringify({
      order: order
        ? {
            id_masked: mask(order.id),
            status: order.status,
            payment_status: order.payment_status,
            total_cents: order.total_cents,
            currency: order.currency,
            session_matches:
              String(order.stripe_session_id || "") === SESSION_ID,
          }
        : null,
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
