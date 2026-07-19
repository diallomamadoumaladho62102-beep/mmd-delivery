#!/usr/bin/env node
/**
 * Diagnose Live Checkout Session after payment attempt.
 * Uses pk_live payment_pages + Supabase order state.
 * Never prints card data or full secrets.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: join(__dirname, "..", ".env.local") });

const SESSION_ID =
  process.env.DIAG_SESSION_ID ||
  "cs_live_b1Dc0KtrNoWuRGUjVRW5RWOX0cFGGjOnJi2Qfp8lDzRODxjFDYiu4BvMxZ";
const ORDER_ID =
  process.env.DIAG_ORDER_ID || "4b8c08ea-3b3e-424c-9266-d4a105046e8a";

function mask(v) {
  const t = String(v ?? "");
  if (!t) return null;
  return t.length <= 12 ? `${t.slice(0, 4)}…` : `${t.slice(0, 10)}…${t.slice(-4)}`;
}

function loadPkLive() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = [
    join(home, ".config", "stripe", "config.toml"),
    join(home, "AppData", "Roaming", "stripe", "config.toml"),
  ].find((p) => existsSync(p));
  if (!configPath) return null;
  const line = readFileSync(configPath, "utf8")
    .split(/\r?\n/)
    .find((l) => /live_mode_pub_key/.test(l));
  return (line || "").match(/['"]([^'"]+)['"]/)?.[1] || null;
}

function loadSkLive() {
  for (const file of [
    join(__dirname, "..", "..", "..", ".tmp", "vercel-prod.env"),
    join(__dirname, "..", ".env.local"),
  ]) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const line = raw.split(/\r?\n/).find((l) => l.startsWith("STRIPE_SECRET_KEY="));
    if (!line) continue;
    let value = line.slice("STRIPE_SECRET_KEY=".length).trim().replace(/^["']|["']$/g, "");
    if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return value;
  }
  const env = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (env.startsWith("sk_live_") || env.startsWith("rk_live_")) return env;
  return null;
}

async function stripeGet(key, path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function pickPaymentError(pi) {
  if (!pi || typeof pi !== "object") return null;
  const err = pi.last_payment_error;
  if (!err) return null;
  return {
    type: err.type ?? null,
    code: err.code ?? null,
    decline_code: err.decline_code ?? null,
    message: err.message ?? null,
    param: err.param ?? null,
    doc_url: err.doc_url ?? null,
    payment_method_type: err.payment_method?.type ?? null,
    // Never dump full PM / card numbers — only brand + last4 if present
    card_brand: err.payment_method?.card?.brand ?? null,
    card_last4: err.payment_method?.card?.last4 ?? null,
    card_country: err.payment_method?.card?.country ?? null,
    card_funding: err.payment_method?.card?.funding ?? null,
  };
}

function pickChargeOutcome(charge) {
  if (!charge || typeof charge !== "object") return null;
  const outcome = charge.outcome || {};
  return {
    charge_id_masked: mask(charge.id),
    status: charge.status ?? null,
    paid: charge.paid ?? null,
    failure_code: charge.failure_code ?? null,
    failure_message: charge.failure_message ?? null,
    outcome_type: outcome.type ?? null,
    outcome_network_status: outcome.network_status ?? null,
    outcome_reason: outcome.reason ?? null,
    outcome_seller_message: outcome.seller_message ?? null,
    outcome_risk_level: outcome.risk_level ?? null,
    outcome_risk_score: outcome.risk_score ?? null,
    network_decline_code:
      charge.network_decline_code ??
      outcome.network_decline_code ??
      charge.payment_method_details?.card?.network_decline_code ??
      null,
  };
}

async function main() {
  const pk = loadPkLive();
  const sk = loadSkLive();
  const now = new Date().toISOString();

  const out = {
    diagnosed_at: now,
    session_id_masked: mask(SESSION_ID),
    order_id_masked: mask(ORDER_ID),
    key_modes: {
      pk_live: Boolean(pk?.startsWith("pk_live_")),
      sk_or_rk_live: Boolean(sk),
    },
    payment_pages: null,
    session_secret: null,
    payment_intent: null,
    charge: null,
    account: null,
    balance: null,
    order_db: null,
    classification: null,
    limitations: [],
  };

  // 1) payment_pages via pk_live (always available if CLI config present)
  if (pk) {
    const { res, json } = await stripeGet(pk, `/payment_pages/${SESSION_ID}`);
    if (res.ok) {
      out.payment_pages = {
        status: json.status,
        payment_status: json.payment_status,
        livemode: json.livemode,
        currency: json.currency,
        amount_total: json.total_summary?.total ?? json.amount_total ?? null,
        customer: json.customer ? mask(json.customer) : null,
        payment_intent: json.payment_intent
          ? typeof json.payment_intent === "string"
            ? mask(json.payment_intent)
            : mask(json.payment_intent.id)
          : null,
        payment_intent_raw_type: typeof json.payment_intent,
        success_url: json.success_url,
        cancel_url: json.cancel_url,
        payment_method_types: json.payment_method_types,
        ordered_payment_method_types: json.ordered_payment_method_types,
        state: json.state,
        enforcement_mode: json.enforcement_mode,
        account_display_name: json.account_settings?.display_name ?? null,
        account_country: json.account_settings?.country ?? null,
        account_id: json.account_settings?.account_id
          ? mask(json.account_settings.account_id)
          : null,
        business_url: json.account_settings?.business_url ?? null,
        statement_descriptor: json.account_settings?.statement_descriptor ?? null,
        is_sandbox_merchant: json.is_sandbox_merchant,
        site_key_present: Boolean(json.site_key),
        line_item_count: json.line_item_group?.line_items?.length ?? null,
        due: json.total_summary?.due ?? null,
      };
      // Capture any error-ish fields on payment page
      out.payment_pages_error_hints = {
        blob_error: json.blob?.error ?? null,
        permissions: json.permissions ?? null,
        policies: json.policies ?? null,
      };
    } else {
      out.payment_pages = {
        http: res.status,
        error: json?.error?.message ?? "retrieve_failed",
        code: json?.error?.code ?? null,
      };
    }
  } else {
    out.limitations.push("pk_live_unavailable");
  }

  // 2) Full session + PI + charge via secret (if available)
  if (sk) {
    const sess = await stripeGet(
      sk,
      `/checkout/sessions/${SESSION_ID}?expand[]=payment_intent&expand[]=payment_intent.latest_charge&expand[]=customer`,
    );
    if (sess.res.ok) {
      const s = sess.json;
      const pi =
        s.payment_intent && typeof s.payment_intent === "object"
          ? s.payment_intent
          : null;
      out.session_secret = {
        status: s.status,
        payment_status: s.payment_status,
        livemode: s.livemode,
        amount_total: s.amount_total,
        currency: s.currency,
        customer: s.customer
          ? typeof s.customer === "string"
            ? mask(s.customer)
            : mask(s.customer.id)
          : null,
        payment_intent_id: pi
          ? mask(pi.id)
          : typeof s.payment_intent === "string"
            ? mask(s.payment_intent)
            : null,
        expires_at: s.expires_at
          ? new Date(s.expires_at * 1000).toISOString()
          : null,
        created: s.created ? new Date(s.created * 1000).toISOString() : null,
        success_url: s.success_url,
        cancel_url: s.cancel_url,
      };
      if (pi) {
        const charge =
          pi.latest_charge && typeof pi.latest_charge === "object"
            ? pi.latest_charge
            : null;
        out.payment_intent = {
          id_masked: mask(pi.id),
          status: pi.status,
          amount: pi.amount,
          currency: pi.currency,
          created: pi.created
            ? new Date(pi.created * 1000).toISOString()
            : null,
          canceled_at: pi.canceled_at
            ? new Date(pi.canceled_at * 1000).toISOString()
            : null,
          cancellation_reason: pi.cancellation_reason ?? null,
          last_payment_error: pickPaymentError(pi),
          latest_charge_id:
            typeof pi.latest_charge === "string"
              ? mask(pi.latest_charge)
              : charge
                ? mask(charge.id)
                : null,
        };
        if (charge) out.charge = pickChargeOutcome(charge);
        // If latest_charge is only an id, fetch it
        if (!charge && typeof pi.latest_charge === "string") {
          const ch = await stripeGet(sk, `/charges/${pi.latest_charge}`);
          if (ch.res.ok) out.charge = pickChargeOutcome(ch.json);
        }
      }
    } else {
      out.session_secret = {
        http: sess.res.status,
        error: sess.json?.error?.message ?? "retrieve_failed",
        code: sess.json?.error?.code ?? null,
      };
    }

    // Account capabilities / restrictions
    const acct = await stripeGet(sk, "/account");
    if (acct.res.ok) {
      const a = acct.json;
      out.account = {
        id_masked: mask(a.id),
        charges_enabled: a.charges_enabled,
        payouts_enabled: a.payouts_enabled,
        details_submitted: a.details_submitted,
        country: a.country,
        default_currency: a.default_currency,
        business_type: a.business_type,
        requirements_currently_due: a.requirements?.currently_due ?? [],
        requirements_past_due: a.requirements?.past_due ?? [],
        requirements_disabled_reason: a.requirements?.disabled_reason ?? null,
        requirements_pending_verification:
          a.requirements?.pending_verification ?? [],
        capabilities_card_payments: a.capabilities?.card_payments ?? null,
        capabilities_transfers: a.capabilities?.transfers ?? null,
      };
    } else {
      out.account = {
        http: acct.res.status,
        error: acct.json?.error?.message ?? "account_retrieve_failed",
      };
    }

    // Recent events around this session
    const events = await stripeGet(
      sk,
      `/events?limit=30&types[]=checkout.session.completed&types[]=payment_intent.payment_failed&types[]=payment_intent.created&types[]=charge.failed&types[]=charge.succeeded&types[]=radar.early_fraud_warning.created`,
    );
    if (events.res.ok) {
      out.recent_events = (events.json.data ?? []).slice(0, 15).map((e) => ({
        id_masked: mask(e.id),
        type: e.type,
        created: e.created ? new Date(e.created * 1000).toISOString() : null,
        livemode: e.livemode,
        object_id_masked: e.data?.object?.id ? mask(e.data.object.id) : null,
      }));
    }

    // Request logs are not fully available via API the same way; try balance as smoke
    const bal = await stripeGet(sk, "/balance");
    if (bal.res.ok) {
      out.balance = {
        livemode: bal.json.livemode,
        available: (bal.json.available ?? []).map((b) => ({
          currency: b.currency,
          amount: b.amount,
        })),
      };
    }
  } else {
    out.limitations.push(
      "sk_live_unavailable — cannot retrieve PaymentIntent last_payment_error, charge outcome, or account requirements via secret API",
    );
  }

  // 3) DB order state
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false }, realtime: { transport: ws } },
    );
    const { data: order } = await admin
      .from("orders")
      .select(
        "id,status,payment_status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,updated_at,created_at,expires_at",
      )
      .eq("id", ORDER_ID)
      .maybeSingle();
    out.order_db = order
      ? {
          id_masked: mask(order.id),
          status: order.status,
          payment_status: order.payment_status,
          total_cents: order.total_cents,
          currency: order.currency,
          session_matches: order.stripe_session_id === SESSION_ID,
          pi_masked: mask(order.stripe_payment_intent_id),
          created_at: order.created_at,
          updated_at: order.updated_at,
          expires_at: order.expires_at,
        }
      : { missing: true };
  } catch (e) {
    out.order_db = { error: e instanceof Error ? e.message : String(e) };
  }

  // Classification
  const err = out.payment_intent?.last_payment_error;
  const charge = out.charge;
  if (err?.code || charge?.failure_code || charge?.outcome_reason) {
    out.classification = {
      stripe_code: err?.code ?? charge?.failure_code ?? null,
      decline_code: err?.decline_code ?? null,
      network_decline_code: charge?.network_decline_code ?? null,
      risk_level: charge?.outcome_risk_level ?? null,
      risk_score: charge?.outcome_risk_score ?? null,
      seller_message: charge?.outcome_seller_message ?? null,
      message: err?.message ?? charge?.failure_message ?? null,
    };
  } else if (
    out.payment_pages?.status === "open" &&
    !out.payment_intent &&
    out.limitations.includes(
      "sk_live_unavailable — cannot retrieve PaymentIntent last_payment_error, charge outcome, or account requirements via secret API",
    )
  ) {
    out.classification = {
      stripe_code: null,
      note: "Session still open; no PI visible via payment_pages. Need sk_live_ for payment attempt error details / Dashboard logs.",
    };
  } else if (out.payment_pages?.status === "open" && !out.session_secret?.payment_intent_id) {
    out.classification = {
      stripe_code: null,
      note: "Session open with no PaymentIntent — Checkout UI error likely occurred before PI creation (account/capability/page-load), not a card decline.",
    };
  }

  const outDir = join(__dirname, "..", ".tmp");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "live-checkout-diagnosis.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
