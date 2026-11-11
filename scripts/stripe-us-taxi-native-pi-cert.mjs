#!/usr/bin/env node
/**
 * US taxi quote → native PaymentIntent (client_secret) via LOCAL Next sk_test.
 * Exercises succeed / decline / cancel. No live charges / payouts.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
let WebSocketCtor;
try {
  WebSocketCtor = require("ws");
} catch {
  WebSocketCtor = undefined;
}

function loadEnvFile(filePath, target) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = line.slice(0, i).trim();
    if (!(k in target) || !target[k]) target[k] = v;
  }
}

const env = { ...process.env };
loadEnvFile(path.join(root, "apps/web/.env.local"), env);
loadEnvFile(path.join(root, "docs/production/final-certification.env"), env);

const apiBase = (process.env.API_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const sk = String(env.STRIPE_SECRET_KEY || "").trim();
const supabaseUrl = String(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
).trim();
const anon = String(
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    "",
).trim();
const email = String(env.E2E_TEST_EMAIL || "").trim();
const password = String(env.E2E_TEST_PASSWORD || "").trim();

const report = {
  apiBase,
  sk_mode: sk.startsWith("sk_test_")
    ? "test"
    : sk.startsWith("sk_live_")
      ? "live"
      : "missing",
  market: "US",
  currency: null,
  merchant_country_code: null,
  payment_intent_id: null,
  client_secret_present: false,
  quote_checkout_id: null,
  outcomes: {},
  ok: false,
  blockers: [],
};

if (report.sk_mode !== "test") {
  report.blockers.push("non-test sk");
  write();
  process.exit(2);
}

const sb = createClient(supabaseUrl, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(WebSocketCtor ? { realtime: { transport: WebSocketCtor } } : {}),
});
const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
  email,
  password,
});
if (authErr || !authData?.session?.access_token) {
  report.blockers.push(authErr?.message || "login failed");
  write();
  process.exit(2);
}
report.session = {
  user_id: authData.user.id,
  email,
  country: "US",
  lat: 40.7128,
  lng: -74.006,
};

async function api(pathname, body) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authData.session.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { res, json };
}

async function stripeForm(pathname, params = {}) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return { res, json: await res.json() };
}

async function stripeGet(id) {
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${id}`, {
    headers: { Authorization: `Bearer ${sk}` },
  });
  return { res, json: await res.json() };
}

async function quoteAndNativePi(dropoffLat, dropoffLng) {
  const body = {
    pickupAddress: "1 World Trade Center, New York, NY",
    dropoffAddress: "Empire State Building, New York, NY",
    pickupLat: 40.7128,
    pickupLng: -74.006,
    dropoffLat,
    dropoffLng,
    countryCode: "US",
    vehicleClass: "standard",
  };
  const quote = await api("/api/taxi/rides/quote", body);
  const total =
    quote.json?.quote?.total_cents ||
    quote.json?.total_cents ||
    quote.json?.quote?.total ||
    null;
  if (!quote.res.ok || quote.json?.ok !== true || !total) {
    return {
      ok: false,
      error: quote.json?.error || `quote_http_${quote.res.status}`,
      quote,
    };
  }
  const created = await api(
    "/api/stripe/client/create-taxi-quote-checkout-session",
    {
      ...body,
      expected_quote_total_cents: total,
      // Triggers openTaxiQuoteNativePaymentIntent → client_secret for PaymentSheet
      payment_ui: "platform_pay",
    },
  );
  return { ok: created.res.ok === true, quote, created, total };
}

const first = await quoteAndNativePi(40.7484, -73.9857);
const created = first.created || { res: { status: 0 }, json: {} };
report.quote_total_cents = first.total || null;
report.create_http = created.res.status;
report.create_error = created.json?.error || created.json?.message || null;
report.payment_intent_id =
  created.json?.payment_intent_id || created.json?.paymentIntentId || null;
report.client_secret_present = Boolean(
  created.json?.client_secret || created.json?.clientSecret,
);
report.currency = created.json?.currency || null;
report.merchant_country_code =
  created.json?.merchant_country_code || created.json?.merchantCountryCode || null;
report.quote_checkout_id =
  created.json?.quote_checkout_id || created.json?.quoteCheckoutId || null;
report.amount = created.json?.amount || created.json?.stripe_amount || null;

if (!first.ok || !report.payment_intent_id) {
  report.blockers.push(
    `create failed http=${created.res?.status} err=${report.create_error || first.error}`,
  );
  write();
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const probe = await stripeGet(report.payment_intent_id);
if (!probe.res.ok || probe.json?.livemode !== false) {
  report.blockers.push(
    `PI not test-mode: livemode=${probe.json?.livemode} err=${probe.json?.error?.message}`,
  );
  write();
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

// success
const okConf = await stripeForm(
  `/payment_intents/${report.payment_intent_id}/confirm`,
  {
    payment_method: "pm_card_visa",
    return_url: `${apiBase}/stripe/success`,
    ...(created.json?.client_secret
      ? { client_secret: created.json.client_secret }
      : {}),
  },
);
report.outcomes.succeed = {
  status: okConf.json?.status || null,
  livemode: okConf.json?.livemode === true,
  ok: okConf.json?.status === "succeeded" && okConf.json?.livemode === false,
  error: okConf.json?.error?.message || null,
};

// decline (new native PI)
const declineFirst = await quoteAndNativePi(40.758, -73.9855);
const declineCreate = declineFirst.created || { json: {} };
const declinePi =
  declineCreate.json?.payment_intent_id ||
  declineCreate.json?.paymentIntentId ||
  null;
if (declinePi) {
  const bad = await stripeForm(`/payment_intents/${declinePi}/confirm`, {
    payment_method: "pm_card_chargeDeclined",
    return_url: `${apiBase}/stripe/success`,
    ...(declineCreate.json?.client_secret
      ? { client_secret: declineCreate.json.client_secret }
      : {}),
  });
  const declined =
    bad.res.status >= 400 ||
    bad.json?.status === "requires_payment_method" ||
    String(bad.json?.error?.message || "")
      .toLowerCase()
      .includes("declined");
  report.outcomes.decline = {
    payment_intent_id: declinePi,
    http: bad.res.status,
    status: bad.json?.status || null,
    ok: declined && bad.json?.livemode !== true,
    error: bad.json?.error?.message || null,
  };
} else {
  report.outcomes.decline = {
    ok: false,
    error: declineCreate.json?.error || declineFirst.error || "no decline PI",
  };
}

// cancel (new native PI)
const cancelFirst = await quoteAndNativePi(40.7614, -73.9776);
const cancelCreate = cancelFirst.created || { json: {} };
const cancelPi =
  cancelCreate.json?.payment_intent_id ||
  cancelCreate.json?.paymentIntentId ||
  null;
if (cancelPi) {
  const canceled = await stripeForm(`/payment_intents/${cancelPi}/cancel`);
  report.outcomes.cancel = {
    payment_intent_id: cancelPi,
    status: canceled.json?.status || null,
    ok:
      canceled.json?.status === "canceled" &&
      canceled.json?.livemode === false,
    error: canceled.json?.error?.message || null,
  };
} else {
  report.outcomes.cancel = {
    ok: false,
    error: cancelCreate.json?.error || cancelFirst.error || "no cancel PI",
  };
}

report.paymentsheet = {
  init_ready: report.client_secret_present && report.sk_mode === "test",
  merchant_country_code: report.merchant_country_code,
  currency: report.currency,
  note: "client_secret from US taxi quote native PI — suitable for PaymentSheet init on pk_test build",
};

report.ok =
  report.outcomes.succeed?.ok === true &&
  report.outcomes.decline?.ok === true &&
  report.outcomes.cancel?.ok === true &&
  String(report.currency || "").toLowerCase() === "usd" &&
  report.client_secret_present;

function write() {
  const outPath = path.join(
    root,
    "docs/production/reports/MMD-STRIPE-US-TAXI-NATIVE-PI-CERT.json",
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    "C:/Users/malad/AppData/Local/Temp/mmd-cert-stripe-us-taxi-native.json",
    JSON.stringify(report, null, 2),
  );
}

write();
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
