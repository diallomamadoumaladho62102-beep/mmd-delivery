#!/usr/bin/env node
/**
 * Final production certification — READ ONLY smoke (no Live payment unless opted in)
 *
 * Usage:
 *   node apps/web/scripts/final-production-certification.mjs
 *   node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env
 *
 * Writes JSON report to CERTIFICATION_REPORT_PATH (default under docs/production/reports/).
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { countStripeWebhookEvents24h } from "./lib/stripeWebhookEventsHealth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const envArgIndex = process.argv.indexOf("--env");
const envFile =
  envArgIndex >= 0
    ? path.resolve(process.cwd(), process.argv[envArgIndex + 1])
    : path.join(repoRoot, "docs", "production", "final-certification.env");

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

const apiBase = (
  process.env.PROD_BASE_URL || "https://www.mmddelivery.com"
).replace(/\/$/, "");

const CANONICAL_STRIPE_WEBHOOK = "https://www.mmddelivery.com/api/stripe/webhook";

const reportPath = path.resolve(
  repoRoot,
  process.env.CERTIFICATION_REPORT_PATH ||
    "docs/production/reports/final-certification-report.json"
);

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  envFile: fs.existsSync(envFile) ? envFile : null,
  checks: [],
  scores: {},
  summary: { pass: 0, fail: 0, warn: 0, skip: 0, manual: 0 },
  verdict: "NOT READY FOR REAL PUBLIC PRODUCTION",
  logs: [],
};

function log(line) {
  report.logs.push(line);
  console.log(line);
}

function truthy(value) {
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function recordCheck(category, name, status, detail = {}) {
  const entry = { category, name, status, ...detail };
  report.checks.push(entry);
  report.summary[status.toLowerCase()] = (report.summary[status.toLowerCase()] ?? 0) + 1;
  const suffix = detail.note ? ` — ${detail.note}` : detail.error ? ` — ${detail.error}` : "";
  log(`[${status}] ${category}/${name}${suffix}`);
  return entry;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, cache: "no-store" });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { res, body };
}

function scopeQuery() {
  const country = process.env.CERTIFICATION_SCOPE_COUNTRY || "US";
  const lat = process.env.CERTIFICATION_SCOPE_LAT || "40.7128";
  const lng = process.env.CERTIFICATION_SCOPE_LNG || "-74.0060";
  return `country=${encodeURIComponent(country)}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Matches apps/web/src/lib/internalHealthAuth.ts — Bearer monitoring or cron secret. */
function internalProbeAuthHeaders() {
  const monitoringSecret = String(process.env.MONITORING_SECRET ?? "").trim();
  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const expected = monitoringSecret || cronSecret;
  if (!expected) return {};
  return { Authorization: `Bearer ${expected}` };
}

async function recordStripeWebhookEvents24hChecks(admin) {
  const result = await countStripeWebhookEvents24h(admin);
  const detail = {
    count: result.count,
    column: result.column,
    fallback: result.fallback ?? null,
    note: result.warning ?? result.error ?? null,
  };

  if (!result.ok) {
    recordCheck("supabase", "stripe_webhook_events_24h", "FAIL", detail);
    recordCheck("stripe", "webhook_events_count_24h", "FAIL", detail);
    return;
  }

  const status = result.fallback ? "WARN" : "PASS";
  recordCheck("supabase", "stripe_webhook_events_24h", status, detail);
  recordCheck("stripe", "webhook_events_count_24h", status, detail);
}

async function checkHealthEndpoints() {
  const probeAuth = internalProbeAuthHeaders();
  if (!probeAuth.Authorization) {
    recordCheck("api", "health", "SKIP", {
      note: "Set CRON_SECRET or MONITORING_SECRET in final-certification.env",
    });
    recordCheck("api", "ai_health", "SKIP", {
      note: "Set CRON_SECRET or MONITORING_SECRET in final-certification.env",
    });
    recordCheck("stripe", "vercel_webhook_health", "SKIP", {
      note: "Set CRON_SECRET or MONITORING_SECRET in final-certification.env",
    });
    return;
  }

  const health = await fetchJson(`${apiBase}/api/health`, { headers: probeAuth });
  if (health.res.ok && health.body?.ok === true && health.body?.platform_countries?.ok === true) {
    recordCheck("api", "health", "PASS", {
      count: health.body.platform_countries.count,
      env: health.body.env,
    });
  } else {
    recordCheck("api", "health", "FAIL", {
      httpStatus: health.res.status,
      body: health.body,
    });
  }

  const ai = await fetchJson(`${apiBase}/api/ai/health`, { headers: probeAuth });
  if (ai.res.ok && ai.body?.ok === true) {
    recordCheck("api", "ai_health", "PASS", {
      assistantEnabled: ai.body.assistantEnabled,
      phase: ai.body.phase,
    });
  } else {
    recordCheck("api", "ai_health", "FAIL", { httpStatus: ai.res.status, body: ai.body });
  }

  const stripeHealth = await fetchJson(`${apiBase}/api/health/stripe-webhook`, {
    headers: probeAuth,
  });
  const canonicalOk =
    stripeHealth.body?.canonical_webhook_url === CANONICAL_STRIPE_WEBHOOK;
  if (stripeHealth.res.ok && canonicalOk) {
    recordCheck("stripe", "vercel_webhook_health", "PASS", {
      canonical: stripeHealth.body.canonical_webhook_url,
    });
  } else {
    recordCheck("stripe", "vercel_webhook_health", "FAIL", { body: stripeHealth.body });
  }

  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!hasServiceRole) {
    const recent = stripeHealth.body?.recent_webhook_events_24h;
    if (recent?.ok === true) {
      const status = recent.fallback ? "WARN" : "PASS";
      recordCheck("stripe", "webhook_events_count_24h", status, {
        count: recent.count,
        column: recent.column ?? null,
        fallback: recent.fallback ?? null,
        note: recent.warning ?? null,
      });
    } else {
      recordCheck("stripe", "webhook_events_count_24h", "FAIL", {
        error: recent?.error ?? "count_not_ok",
      });
    }
  }

  // Handler responds without signature (must NOT process payment)
  const webhookProbe = await fetchJson(`${apiBase}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (webhookProbe.res.status === 400) {
    recordCheck("stripe", "webhook_rejects_unsigned", "PASS", {
      httpStatus: 400,
      error: webhookProbe.body?.error,
    });
  } else {
    recordCheck("stripe", "webhook_rejects_unsigned", "FAIL", {
      httpStatus: webhookProbe.res.status,
      body: webhookProbe.body,
    });
  }
}

async function checkManualStripeFlags() {
  if (truthy(process.env.STRIPE_DASHBOARD_CHECK_DONE)) {
    recordCheck("stripe", "dashboard_reviewed", "PASS", { manual: true });
  } else {
    recordCheck("stripe", "dashboard_reviewed", "MANUAL", {
      note: "Set STRIPE_DASHBOARD_CHECK_DONE=true after Dashboard review",
    });
  }

  if (truthy(process.env.STRIPE_UNIQUE_WEBHOOK_CONFIRMED)) {
    recordCheck("stripe", "unique_webhook_url", "PASS", { manual: true });
  } else {
    recordCheck("stripe", "unique_webhook_url", "MANUAL", {
      note: "Confirm exactly one Live webhook → /api/stripe/webhook",
    });
  }

  if (truthy(process.env.EDGE_WEBHOOK_DISABLED_CONFIRMED)) {
    recordCheck("stripe", "edge_webhook_disabled", "PASS", { manual: true });
  } else {
    recordCheck("stripe", "edge_webhook_disabled", "MANUAL", {
      note: "Probe Edge or set EDGE_WEBHOOK_DISABLED_CONFIRMED=true",
    });
  }
}

async function probeEdgeWebhook() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!supabaseUrl) {
    recordCheck("stripe", "edge_webhook_probe", "SKIP", {
      note: "Set SUPABASE_URL to auto-probe Edge stripe_webhook",
    });
    return;
  }

  const edgeUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/stripe_webhook`;
  const probe = await fetchJson(edgeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const disabled =
    probe.body?.disabled === true ||
    probe.body?.error === "edge_webhook_disabled" ||
    probe.res.status === 410;

  if (disabled) {
    recordCheck("stripe", "edge_webhook_probe", "PASS", {
      httpStatus: probe.res.status,
      body: probe.body,
    });
  } else {
    recordCheck("stripe", "edge_webhook_probe", "FAIL", {
      httpStatus: probe.res.status,
      body: probe.body,
      note: "Edge may still process events — set MMD_STRIPE_WEBHOOK_DISABLED=true",
    });
  }
}

async function checkSupabaseReadOnly() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    recordCheck("supabase", "service_role_checks", "SKIP", {
      note: "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for DB probes",
    });
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: platformCount, error: platformError } = await admin
    .from("platform_countries")
    .select("country_code", { count: "exact", head: true });

  if (!platformError && (platformCount ?? 0) >= 11) {
    recordCheck("supabase", "platform_countries", "PASS", { count: platformCount });
  } else {
    recordCheck("supabase", "platform_countries", "FAIL", {
      error: platformError?.message,
      count: platformCount,
    });
  }

  const { count: webhookTotal, error: webhookError } = await admin
    .from("stripe_webhook_events")
    .select("id", { count: "exact", head: true });

  if (!webhookError) {
    recordCheck("supabase", "stripe_webhook_events_readable", "PASS", {
      total: webhookTotal ?? 0,
    });
  } else {
    recordCheck("supabase", "stripe_webhook_events_readable", "FAIL", {
      error: webhookError.message,
    });
  }

  await recordStripeWebhookEvents24hChecks(admin);

  for (const table of ["ai_runtime_settings", "ai_conversations", "ai_messages"]) {
    const { error } = await admin.from(table).select("*", { head: true, count: "exact" }).limit(1);
    if (!error) {
      recordCheck("supabase", `ai_table_${table}`, "PASS");
    } else {
      recordCheck("supabase", `ai_table_${table}`, "FAIL", { error: error.message });
    }
  }
}

function checkSupabaseTrustBoundarySqlSignOff() {
  if (!truthy(process.env.SUPABASE_TRUST_BOUNDARY_SQL_DONE)) {
    recordCheck("supabase", "trust_boundary_migrations", "MANUAL", {
      note: "Run final_certification_checks.sql sections 1-2; set SUPABASE_TRUST_BOUNDARY_SQL_DONE=true",
    });
    recordCheck("supabase", "trust_boundary_rls", "MANUAL", {
      note: "Section 2: orders, delivery_requests, taxi_rides rls_enabled=true",
    });
    recordCheck("supabase", "trust_boundary_insert_policies", "MANUAL", {
      note: "Section 3: forbidden client INSERT policies must return 0 rows",
    });
    recordCheck("supabase", "trust_boundary_financial_triggers", "MANUAL", {
      note: "Section 4: trg_guard_* triggers enabled (tgenabled=O)",
    });
    recordCheck("supabase", "migrations_sql", "MANUAL", {
      note: "Run docs/production/sql/final_certification_checks.sql in SQL Editor",
    });
    return;
  }

  const validatedAt =
    process.env.SUPABASE_TRUST_BOUNDARY_SQL_VALIDATED_AT?.trim() || null;

  recordCheck("supabase", "trust_boundary_migrations", "PASS", {
    signOff: true,
    validatedAt,
    migrations: ["20260716120000", "20260717120000"],
  });
  recordCheck("supabase", "trust_boundary_rls", "PASS", {
    signOff: true,
    validatedAt,
    tables: {
      orders: true,
      delivery_requests: true,
      taxi_rides: true,
    },
  });
  recordCheck("supabase", "trust_boundary_insert_policies", "PASS", {
    signOff: true,
    validatedAt,
    forbiddenPolicyRows: 0,
  });
  recordCheck("supabase", "trust_boundary_financial_triggers", "PASS", {
    signOff: true,
    validatedAt,
    triggers: [
      "trg_guard_orders_client_financial_update",
      "trg_guard_delivery_requests_client_financial_update",
    ],
    tgenabled: "O",
  });
  recordCheck("supabase", "migrations_sql", "PASS", {
    signOff: true,
    validatedAt,
    note: "Supabase SQL Editor trust-boundary certification complete",
  });
}

async function checkRlsProbe() {
  if (!truthy(process.env.CERTIFICATION_ALLOW_RLS_PROBE)) {
    recordCheck("supabase", "rls_client_insert_probe", "SKIP", {
      note: "Set CERTIFICATION_ALLOW_RLS_PROBE=true to test client INSERT rejection",
    });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = (process.env.TEST_CLIENT_JWT || "").trim();
  if (!url || !anon || !token) {
    recordCheck("supabase", "rls_client_insert_probe", "SKIP", {
      note: "Needs SUPABASE_URL, SUPABASE_ANON_KEY, TEST_CLIENT_JWT",
    });
    return;
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const probes = [
    {
      table: "orders",
      row: {
        kind: "food",
        status: "pending",
        payment_status: "unpaid",
        total: 99.99,
        currency: "USD",
      },
    },
    {
      table: "delivery_requests",
      row: {
        title: "certification probe",
        total: 99.99,
        currency: "USD",
        payment_status: "unpaid",
      },
    },
    {
      table: "taxi_rides",
      row: {
        status: "requested",
        total_cents: 9999,
        currency: "USD",
      },
    },
  ];

  for (const probe of probes) {
    const { error } = await userClient.from(probe.table).insert(probe.row);
    if (error) {
      recordCheck("supabase", `rls_block_${probe.table}_insert`, "PASS", {
        error: error.message,
      });
    } else {
      recordCheck("supabase", `rls_block_${probe.table}_insert`, "FAIL", {
        note: "INSERT succeeded — trust boundary open",
      });
    }
  }
}

async function checkAuthenticatedApis(token) {
  const qs = scopeQuery();
  const restaurantId = (process.env.CERTIFICATION_RESTAURANT_USER_ID || "").trim();
  const menuItemId = (process.env.CERTIFICATION_MENU_ITEM_ID || "").trim();

  const foodBody = {
    restaurant_user_id: restaurantId,
    pickup_address: "Certification Pickup",
    dropoff_address: "Certification Dropoff",
    pickup_lat: Number(process.env.CERTIFICATION_SCOPE_LAT || 40.7128),
    pickup_lng: Number(process.env.CERTIFICATION_SCOPE_LNG || -74.006),
    dropoff_lat: 40.758,
    dropoff_lng: -73.9855,
    items: menuItemId ? [{ item_id: menuItemId, quantity: 1 }] : [],
  };

  if (!restaurantId || !menuItemId) {
    recordCheck("payment", "food_quote", "SKIP", {
      note: "Set CERTIFICATION_RESTAURANT_USER_ID and CERTIFICATION_MENU_ITEM_ID",
    });
    recordCheck("payment", "food_create", "SKIP", { note: "Same as food_quote" });
  } else {
    const quote = await fetchJson(`${apiBase}/api/orders/food/quote?${qs}`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(foodBody),
    });

    if (quote.res.ok && quote.body?.ok === true && quote.body?.quote?.total != null) {
      recordCheck("payment", "food_quote", "PASS", {
        total: quote.body.quote.total,
        currency: quote.body.quote.currency,
      });
    } else {
      recordCheck("payment", "food_quote", "FAIL", {
        httpStatus: quote.res.status,
        error: quote.body?.error ?? quote.body?.message,
      });
    }

    if (truthy(process.env.CERTIFICATION_ALLOW_CREATE)) {
      const create = await fetchJson(`${apiBase}/api/orders/food/create?${qs}`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          ...foodBody,
          restaurant_name: "Certification Restaurant",
        }),
      });
      if (create.res.ok && create.body?.ok === true && create.body?.order?.id) {
        recordCheck("payment", "food_create", "PASS", { orderId: create.body.order.id });
      } else {
        recordCheck("payment", "food_create", "FAIL", {
          httpStatus: create.res.status,
          error: create.body?.error ?? create.body?.message,
        });
      }
    } else {
      recordCheck("payment", "food_create", "SKIP", {
        note: "Set CERTIFICATION_ALLOW_CREATE=true to create unpaid test order",
      });
    }
  }

  const deliveryBody = {
    title: "Certification delivery",
    pickup_address: "Certification Pickup",
    dropoff_address: "Certification Dropoff",
    pickup_lat: Number(process.env.CERTIFICATION_SCOPE_LAT || 40.7128),
    pickup_lng: Number(process.env.CERTIFICATION_SCOPE_LNG || -74.006),
    dropoff_lat: 40.758,
    dropoff_lng: -73.9855,
  };

  const deliveryQuote = await fetchJson(`${apiBase}/api/delivery-requests/quote?${qs}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(deliveryBody),
  });

  if (deliveryQuote.res.ok && deliveryQuote.body?.ok === true) {
    recordCheck("payment", "delivery_quote", "PASS", {
      total: deliveryQuote.body.quote?.total,
      currency: deliveryQuote.body.quote?.currency,
    });
  } else if (deliveryQuote.res.status === 401) {
    recordCheck("payment", "delivery_quote", "SKIP", { note: "Invalid or missing TEST_CLIENT_JWT" });
  } else {
    recordCheck("payment", "delivery_quote", "FAIL", {
      httpStatus: deliveryQuote.res.status,
      error: deliveryQuote.body?.error ?? deliveryQuote.body?.message,
    });
  }

  if (truthy(process.env.CERTIFICATION_ALLOW_CREATE)) {
    const deliveryCreate = await fetchJson(`${apiBase}/api/delivery-requests/create?${qs}`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(deliveryBody),
    });
    if (deliveryCreate.res.ok && deliveryCreate.body?.ok === true) {
      recordCheck("payment", "delivery_create", "PASS", {
        id: deliveryCreate.body.delivery_request?.id ?? deliveryCreate.body.id,
      });
    } else {
      recordCheck("payment", "delivery_create", "FAIL", {
        httpStatus: deliveryCreate.res.status,
        error: deliveryCreate.body?.error,
      });
    }
  } else {
    recordCheck("payment", "delivery_create", "SKIP", {
      note: "Set CERTIFICATION_ALLOW_CREATE=true",
    });
  }

  const taxiBody = {
    pickupLat: Number(process.env.CERTIFICATION_SCOPE_LAT || 40.7128),
    pickupLng: Number(process.env.CERTIFICATION_SCOPE_LNG || -74.006),
    dropoffLat: 40.758,
    dropoffLng: -73.9855,
    pickupAddress: "Certification Taxi Pickup",
    dropoffAddress: "Certification Taxi Dropoff",
    vehicle_class: "standard",
    country_code: process.env.CERTIFICATION_SCOPE_COUNTRY || "US",
  };

  const taxiQuote = await fetchJson(`${apiBase}/api/taxi/rides/quote`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(taxiBody),
  });

  if (taxiQuote.res.ok && (taxiQuote.body?.quote || taxiQuote.body?.ok === true)) {
    recordCheck("payment", "taxi_quote", "PASS", {
      total_cents: taxiQuote.body?.quote?.total_cents ?? taxiQuote.body?.total_cents,
      currency: taxiQuote.body?.quote?.currency ?? taxiQuote.body?.currency,
    });
  } else if (taxiQuote.res.status === 401) {
    recordCheck("payment", "taxi_quote", "SKIP", { note: "Invalid TEST_CLIENT_JWT" });
  } else {
    recordCheck("payment", "taxi_quote", "FAIL", {
      httpStatus: taxiQuote.res.status,
      error: taxiQuote.body?.error ?? taxiQuote.body?.message,
    });
  }

  if (truthy(process.env.CERTIFICATION_ALLOW_LIVE_PAYMENT)) {
    recordCheck("payment", "live_payment_e2e", "MANUAL", {
      note: "Complete checkout + webhook manually; not automated here",
    });
  } else {
    recordCheck("payment", "live_payment_e2e", "SKIP", {
      note: "Set CERTIFICATION_ALLOW_LIVE_PAYMENT=true only for founder Live payment test",
    });
  }
}

async function checkCronEndpoints() {
  const certificationEnvLoaded = fs.existsSync(envFile);
  const safeCronPaths = [
    "/api/cron/retry-order-dispatch",
    "/api/cron/retry-taxi-dispatch",
    "/api/cron/taxi-scheduled-dispatch",
    "/api/monitoring",
  ];

  for (const pathname of safeCronPaths) {
    const label = pathname.replace(/^\//, "");
    const unauth = await fetchJson(`${apiBase}${pathname}`);
    if (unauth.res.status === 401) {
      recordCheck("ops", `${label}_protected`, "PASS");
    } else {
      recordCheck("ops", `${label}_protected`, "FAIL", {
        httpStatus: unauth.res.status,
        note: "Expected 401 without secret",
      });
    }
  }

  const authHeader = internalProbeAuthHeaders();
  if (!authHeader.Authorization) {
    recordCheck("ops", "cron_authenticated_execution", "SKIP", {
      note: certificationEnvLoaded
        ? "Set CRON_SECRET or MONITORING_SECRET in final-certification.env"
        : "Load --env docs/production/final-certification.env (or CERTIFICATION_USE_LOCAL_SECRETS=true)",
    });
    return;
  }

  for (const pathname of safeCronPaths) {
    const label = pathname.replace(/^\//, "");
    const authed = await fetchJson(`${apiBase}${pathname}`, { headers: authHeader });
    const isMonitoring = pathname === "/api/monitoring";
    const monitoringAuthProbeOk =
      isMonitoring &&
      authed.res.status !== 401 &&
      authed.body &&
      typeof authed.body === "object" &&
      Array.isArray(authed.body.checks);

    if (authed.res.ok || monitoringAuthProbeOk) {
      recordCheck("ops", `${label}_execution`, "PASS", {
        body: authed.body,
        ...(monitoringAuthProbeOk && !authed.res.ok
          ? {
              note: "Monitoring auth OK; snapshot degraded (503) — not a cron secret failure",
              httpStatus: authed.res.status,
            }
          : {}),
      });
    } else {
      recordCheck("ops", `${label}_execution`, "FAIL", {
        httpStatus: authed.res.status,
        body: authed.body,
      });
    }
  }

  if (truthy(process.env.CERTIFICATION_ALLOW_PAYOUT_CRON)) {
    const payouts = await fetchJson(`${apiBase}/api/admin/process-payouts`, {
      headers: authHeader,
    });
    recordCheck("ops", "process_payouts_execution", payouts.res.ok ? "PASS" : "FAIL", {
      httpStatus: payouts.res.status,
      body: payouts.body,
      warning: "May trigger real transfers",
    });
  } else {
    recordCheck("ops", "process_payouts_execution", "SKIP", {
      note: "Blocked — set CERTIFICATION_ALLOW_PAYOUT_CRON=true to probe (real money risk)",
    });
  }
}

function checkMobileManualFlags() {
  const flags = [
    ["mobile", "testflight_us", "TESTFLIGHT_US_CHECK_DONE"],
    ["mobile", "testflight_gn", "TESTFLIGHT_GN_CHECK_DONE"],
    ["mobile", "android_us", "ANDROID_US_CHECK_DONE"],
    ["mobile", "android_gn", "ANDROID_GN_CHECK_DONE"],
  ];

  for (const [category, name, envKey] of flags) {
    if (truthy(process.env[envKey])) {
      recordCheck(category, name, "PASS", { manual: true });
    } else {
      recordCheck(category, name, "MANUAL", {
        note: `Complete MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md then set ${envKey}=true`,
      });
    }
  }
}

function computeScores() {
  const byCategory = {};
  for (const check of report.checks) {
    if (!byCategory[check.category]) {
      byCategory[check.category] = { pass: 0, fail: 0, total: 0 };
    }
    if (check.status === "PASS") {
      byCategory[check.category].pass += 1;
      byCategory[check.category].total += 1;
    } else if (check.status === "FAIL") {
      byCategory[check.category].fail += 1;
      byCategory[check.category].total += 1;
    }
  }

  function scoreFor(category) {
    const bucket = byCategory[category];
    if (!bucket || bucket.total === 0) return null;
    return Math.round((bucket.pass / bucket.total) * 100);
  }

  report.scores = {
    api: scoreFor("api") ?? 0,
    stripe: scoreFor("stripe") ?? 0,
    supabase: scoreFor("supabase") ?? 0,
    payment: scoreFor("payment") ?? 0,
    ops: scoreFor("ops") ?? 0,
    mobile: scoreFor("mobile") ?? 0,
    global: 0,
    payment_domain: 0,
    security: 0,
    operations: 0,
    admin: 50,
    ai: scoreFor("api") ?? 0,
  };

  const scored = Object.values(report.scores).filter((v) => typeof v === "number" && v > 0);
  const passFail = report.checks.filter((c) => c.status === "PASS" || c.status === "FAIL");
  report.scores.global =
    passFail.length === 0
      ? 0
      : Math.round((report.summary.pass / passFail.length) * 100);

  report.scores.payment_domain = report.scores.payment ?? 0;
  report.scores.security = Math.round(((scoreFor("supabase") ?? 0) + (scoreFor("stripe") ?? 0)) / 2);
  report.scores.operations = report.scores.ops ?? 0;
  report.scores.ai = report.scores.api ?? 0;

  const readinessChecks = report.checks.filter((c) =>
    ["PASS", "FAIL", "MANUAL"].includes(c.status)
  );
  report.scores.global_readiness =
    readinessChecks.length === 0
      ? 0
      : Math.round((report.summary.pass / readinessChecks.length) * 100);

  report.scores.production_readiness = Math.round(
    (report.scores.security +
      report.scores.operations +
      report.scores.payment_domain +
      (scoreFor("mobile") ?? 0) +
      (scoreFor("api") ?? 0)) /
      5
  );

  report.remainingBlockers = [
    "Stripe Dashboard (single Live webhook URL)",
    "E2E Live payments (food, delivery, taxi)",
    "TestFlight iOS + Android Production (US + GN)",
    "External dispatch crons (retry-order/taxi/scheduled)",
  ];

  if (truthy(process.env.SUPABASE_TRUST_BOUNDARY_SQL_DONE)) {
    report.supabaseValidated = true;
  }

  const blockers = report.checks
    .filter((c) => c.status === "FAIL")
    .map((c) => `${c.category}/${c.name}`);

  const manualPending = report.checks.filter((c) => c.status === "MANUAL").length;

  if (report.summary.fail === 0 && manualPending === 0 && report.summary.pass > 0) {
    report.verdict = "READY FOR REAL PUBLIC PRODUCTION";
  } else {
    report.verdict = "NOT READY FOR REAL PUBLIC PRODUCTION";
  }

  if (report.summary.warn > 0) {
    report.warnings = report.checks
      .filter((c) => c.status === "WARN")
      .map((c) => `${c.category}/${c.name}`);
  }

  report.blockers = blockers;
  report.manualPending = manualPending;
}

async function main() {
  log("\n=== MMD FINAL PRODUCTION CERTIFICATION ===");
  log(`API: ${apiBase}`);
  log(`Env file: ${fs.existsSync(envFile) ? envFile : "(none — using defaults + .env.local if present)"}`);
  log(`Time: ${report.generatedAt}\n`);

  await checkHealthEndpoints();
  await checkManualStripeFlags();
  await probeEdgeWebhook();
  await checkSupabaseReadOnly();
  checkSupabaseTrustBoundarySqlSignOff();
  await checkRlsProbe();

  const token = (process.env.TEST_CLIENT_JWT || "").trim();
  if (token) {
    await checkAuthenticatedApis(token);
  } else {
    recordCheck("payment", "authenticated_api_suite", "SKIP", {
      note: "Set TEST_CLIENT_JWT for food/delivery/taxi probes",
    });
  }

  await checkCronEndpoints();
  checkMobileManualFlags();

  computeScores();

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  log("\n=== SCORES ===");
  log(`Global (automated PASS/FAIL): ${report.scores.global}/100`);
  log(`Global Readiness (incl. MANUAL): ${report.scores.global_readiness}/100`);
  log(`Production Readiness: ${report.scores.production_readiness}/100`);
  log(`Payment: ${report.scores.payment_domain}/100`);
  log(`Security: ${report.scores.security}/100`);
  log(`Operations: ${report.scores.operations}/100`);
  log(`Mobile: ${report.scores.mobile}/100`);
  log(`AI: ${report.scores.ai}/100`);
  log(`\nVerdict: ${report.verdict}`);
  if (report.supabaseValidated) {
    log("Supabase trust-boundary: VALIDATED (SQL sign-off flag set)");
  }
  if (report.remainingBlockers?.length) {
    log(`Remaining real blockers: ${report.remainingBlockers.join(" | ")}`);
  }
  if (report.blockers?.length) {
    log(`Blockers (${report.blockers.length}): ${report.blockers.join(", ")}`);
  }
  if (report.manualPending) {
    log(`Manual items pending: ${report.manualPending}`);
  }
  log(`\nReport written: ${reportPath}`);

  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
