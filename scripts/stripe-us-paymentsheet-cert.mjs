#!/usr/bin/env node
/**
 * US Stripe PaymentSheet certification — TEST MODE ONLY.
 *
 * - Aborts if STRIPE_SECRET_KEY is not sk_test_*
 * - Uses existing E2E client (no account create/delete)
 * - Creates USD PaymentIntents with US metadata
 * - Exercises succeed / decline / cancel
 * - Never charges live, never payouts
 *
 * Run:
 *   node scripts/stripe-us-paymentsheet-cert.mjs
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
loadEnvFile(path.join(root, "apps/mobile/.env"), env);
loadEnvFile(path.join(root, "docs/production/final-certification.env"), env);

const sk = String(env.STRIPE_SECRET_KEY || "").trim();
const pk = String(
  env.EXPO_PUBLIC_STRIPE_PK ||
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    env.STRIPE_PUBLISHABLE_KEY ||
    "",
).trim();
const supabaseUrl = String(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
).trim();
const anon = String(
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    "",
).trim();
const email = String(env.E2E_TEST_EMAIL || "").trim();
const password = String(env.E2E_TEST_PASSWORD || "").trim();
const scopeCountry = String(env.CERTIFICATION_SCOPE_COUNTRY || "US").trim();
const scopeLat = Number(env.CERTIFICATION_SCOPE_LAT || 40.7128);
const scopeLng = Number(env.CERTIFICATION_SCOPE_LNG || -74.006);

const report = {
  generatedAt: new Date().toISOString(),
  mode: {
    sk: sk.startsWith("sk_test_")
      ? "test"
      : sk.startsWith("sk_live_")
        ? "live"
        : "missing",
    pk: pk.startsWith("pk_test_")
      ? "test"
      : pk.startsWith("pk_live_")
        ? "live"
        : "missing",
  },
  session: null,
  payment_intents: {},
  outcomes: {},
  cash_gn_smoke: null,
  paymentsheet_ui: {
    status: "pending",
    note: "Native PaymentSheet present requires device/emulator with pk_test build",
  },
  ok: false,
  blockers: [],
};

function authHeader() {
  return {
    Authorization: `Bearer ${sk}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

async function stripeForm(pathname, params = {}, method = "POST") {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) body.append(k, String(item));
    } else if (typeof v === "object") {
      for (const [sk2, sv] of Object.entries(v)) {
        body.append(`${k}[${sk2}]`, String(sv));
      }
    } else {
      body.append(k, String(v));
    }
  }
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: authHeader(),
    body: method === "GET" ? undefined : body,
  });
  const json = await res.json();
  return { res, json };
}

async function createUsdPi(label) {
  const { res, json } = await stripeForm("/payment_intents", {
    amount: "500",
    currency: "usd",
    "automatic_payment_methods[enabled]": "true",
    "metadata[mmd_cert]": "stripe_us_paymentsheet",
    "metadata[market]": "US",
    "metadata[label]": label,
    "metadata[scope_lat]": String(scopeLat),
    "metadata[scope_lng]": String(scopeLng),
  });
  if (!res.ok || json.livemode === true) {
    throw new Error(
      `PI create failed/live: ${json.error?.message || res.status} livemode=${json.livemode}`,
    );
  }
  return json;
}

async function main() {
  if (report.mode.sk !== "test") {
    report.blockers.push("Refusing non-test STRIPE_SECRET_KEY");
    writeReport();
    process.exit(2);
  }
  if (report.mode.pk === "live") {
    report.blockers.push("Refusing pk_live publishable key for PaymentSheet cert");
    writeReport();
    process.exit(2);
  }
  if (!email || !password) {
    report.blockers.push("E2E_TEST_EMAIL/PASSWORD missing");
    writeReport();
    process.exit(2);
  }
  if (!supabaseUrl || !anon) {
    report.blockers.push("Supabase URL/anon missing");
    writeReport();
    process.exit(2);
  }
  if (scopeCountry !== "US") {
    report.blockers.push(
      `CERTIFICATION_SCOPE_COUNTRY=${scopeCountry} (expected US)`,
    );
    writeReport();
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
    report.blockers.push(`US E2E login failed: ${authErr?.message || "no session"}`);
    writeReport();
    process.exit(2);
  }

  const userId = authData.user.id;
  const { data: profile } = await sb
    .from("profiles")
    .select("id,role,full_name,preferred_locale,country_code")
    .eq("id", userId)
    .maybeSingle();

  report.session = {
    user_id: userId,
    email,
    role: profile?.role || null,
    country_code: profile?.country_code || null,
    scope_country: scopeCountry,
    scope_lat: scopeLat,
    scope_lng: scopeLng,
    currency_expected: "USD",
    login_ok: true,
  };

  // --- succeed ---
  const piOk = await createUsdPi("succeed");
  report.payment_intents.succeed_id = piOk.id;
  const confOk = await stripeForm(`/payment_intents/${piOk.id}/confirm`, {
    payment_method: "pm_card_visa",
    return_url: "https://www.mmddelivery.com/stripe/success",
  });
  report.outcomes.succeed = {
    status: confOk.json.status || null,
    livemode: confOk.json.livemode === true,
    amount: confOk.json.amount,
    currency: confOk.json.currency,
    error: confOk.json.error?.message || null,
    ok: confOk.json.status === "succeeded" && confOk.json.livemode === false,
  };

  // --- decline ---
  const piBad = await createUsdPi("decline");
  report.payment_intents.decline_id = piBad.id;
  const confBad = await stripeForm(`/payment_intents/${piBad.id}/confirm`, {
    payment_method: "pm_card_chargeDeclined",
    return_url: "https://www.mmddelivery.com/stripe/success",
  });
  const declined =
    confBad.json.status === "requires_payment_method" ||
    confBad.json.error?.code === "card_declined" ||
    String(confBad.json.error?.message || "")
      .toLowerCase()
      .includes("declined") ||
    confBad.res.status >= 400;
  report.outcomes.decline = {
    http: confBad.res.status,
    status: confBad.json.status || null,
    livemode: confBad.json.livemode === true,
    error: confBad.json.error?.message || null,
    ok: declined && confBad.json.livemode !== true,
  };

  // --- cancel ---
  const piCancel = await createUsdPi("cancel");
  report.payment_intents.cancel_id = piCancel.id;
  const canceled = await stripeForm(`/payment_intents/${piCancel.id}/cancel`);
  report.outcomes.cancel = {
    status: canceled.json.status || null,
    livemode: canceled.json.livemode === true,
    error: canceled.json.error?.message || null,
    ok: canceled.json.status === "canceled" && canceled.json.livemode === false,
  };

  // PaymentSheet init readiness: client_secret present + pk_test
  report.paymentsheet_api = {
    has_client_secret: Boolean(piOk.client_secret),
    client_secret_prefix: String(piOk.client_secret || "").slice(0, 8),
    pk_test: report.mode.pk === "test",
    merchant_country: "US",
    currency: "usd",
    note: "client_secret usable by PaymentSheet init on a pk_test native build",
  };

  // Cash GN non-regression smoke (read-only via service role when present)
  const service = String(
    env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();
  if (service) {
    const admin = createClient(supabaseUrl, service, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(WebSocketCtor ? { realtime: { transport: WebSocketCtor } } : {}),
    });
    const { data: gnCash, error: gnErr } = await admin
      .from("taxi_rides")
      .select(
        "id,payment_method,payment_status,is_test,hidden_from_user,country_code",
      )
      .eq("is_test", true)
      .eq("hidden_from_user", true)
      .or("payment_method.eq.cash,payment_status.eq.cash_collected")
      .order("created_at", { ascending: false })
      .limit(3);
    report.cash_gn_smoke = {
      ok: !gnErr && Array.isArray(gnCash) && gnCash.length > 0,
      error: gnErr?.message || null,
      sample_count: Array.isArray(gnCash) ? gnCash.length : 0,
      samples: (gnCash || []).map((r) => ({
        id: r.id,
        payment_method: r.payment_method,
        payment_status: r.payment_status,
        is_test: r.is_test,
        hidden_from_user: r.hidden_from_user,
        country_code: r.country_code,
      })),
    };
  } else {
    report.cash_gn_smoke = {
      ok: false,
      error: "service role unavailable for read-only GN cash smoke",
      sample_count: 0,
      samples: [],
    };
  }

  // Edge create_payment_intent mode probe (no charge): fake order → expect error;
  // if a PI id ever appears, refuse live by attempting sk_test retrieve.
  try {
    const edgeRes = await fetch(
      `${supabaseUrl}/functions/v1/create_payment_intent`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authData.session.access_token}`,
          apikey: anon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: "00000000-0000-4000-8000-000000000000",
          order_id: "00000000-0000-4000-8000-000000000000",
        }),
      },
    );
    const edgeJson = await edgeRes.json().catch(() => ({}));
    const maybePi =
      edgeJson?.payment_intent_id ||
      edgeJson?.paymentIntentId ||
      (typeof edgeJson?.client_secret === "string"
        ? edgeJson.client_secret.split("_secret")[0]
        : null);
    let edgeMode = "unknown";
    if (maybePi) {
      const probe = await stripeForm(`/payment_intents/${maybePi}`, {}, "GET");
      if (probe.res.ok && probe.json?.livemode === false) edgeMode = "test";
      else if (
        String(probe.json?.error?.message || "")
          .toLowerCase()
          .includes("no such payment_intent")
      ) {
        edgeMode = "live_or_other_account";
      } else {
        edgeMode = `http_${probe.res.status}`;
      }
    } else {
      edgeMode = `no_pi_http_${edgeRes.status}`;
    }
    report.edge_create_payment_intent = {
      http: edgeRes.status,
      error: edgeJson?.error || edgeJson?.message || null,
      mode_guess: edgeMode,
      note: "Production edge may use live keys; native PaymentSheet UI must not confirm live charges in this cert",
    };
    if (edgeMode === "live_or_other_account") {
      report.paymentsheet_ui.status = "blocked_live_edge";
      report.paymentsheet_ui.note =
        "Supabase create_payment_intent appears live/other-account vs local sk_test — UI PaymentSheet confirm refused";
    }
  } catch (edgeErr) {
    report.edge_create_payment_intent = {
      error: String(edgeErr?.message || edgeErr),
    };
  }

  report.ok =
    report.outcomes.succeed?.ok === true &&
    report.outcomes.decline?.ok === true &&
    report.outcomes.cancel?.ok === true &&
    report.paymentsheet_api?.has_client_secret === true &&
    report.mode.sk === "test" &&
    report.mode.pk !== "live";

  writeReport();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

function writeReport() {
  const outDir = path.join(root, "docs/production/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "MMD-STRIPE-US-PAYMENTSHEET-CERT.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    "C:/Users/malad/AppData/Local/Temp/mmd-cert-stripe-us-paymentsheet.json",
    JSON.stringify(report, null, 2),
  );
}

main().catch((err) => {
  report.blockers.push(String(err?.message || err));
  writeReport();
  console.error(err);
  process.exit(1);
});
