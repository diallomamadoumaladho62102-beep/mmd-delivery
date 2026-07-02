#!/usr/bin/env node
/**
 * B2 — Stripe Live webhook verification (read-only).
 * Usage: node scripts/verify-b2-stripe-webhook.mjs --env docs/production/final-certification.env
 * Optional: --vercel-env apps/web/.env.b2-check.tmp for CRON_SECRET from Vercel pull
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_URL = "https://www.mmddelivery.com/api/stripe/webhook";
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.updated",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  const abs = path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(root, path);
  const text = readFileSync(abs, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function tail4(value) {
  const s = String(value ?? "").trim();
  return s.length >= 4 ? s.slice(-4) : s ? "****" : "(empty)";
}

function truthy(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseArgs() {
  const args = process.argv.slice(2);
  let envPath = null;
  let vercelEnvPath = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env" && args[i + 1]) envPath = args[++i];
    if (args[i] === "--vercel-env" && args[i + 1]) vercelEnvPath = args[++i];
  }
  return { envPath, vercelEnvPath };
}

async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `Stripe API ${res.status}`);
  }
  return body;
}

async function probeRuntimeWebhookSecret(prodBase) {
  try {
    const res = await fetch(`${prodBase}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await res.json().catch(() => ({}));
    return {
      httpStatus: res.status,
      error: body?.error ?? null,
      secretConfigured: res.status === 400 && body?.error === "Missing stripe-signature",
    };
  } catch (e) {
    return {
      httpStatus: null,
      error: e instanceof Error ? e.message : String(e),
      secretConfigured: false,
    };
  }
}

async function main() {
  const { envPath, vercelEnvPath } = parseArgs();
  if (vercelEnvPath) loadEnvFile(vercelEnvPath);
  if (envPath) loadEnvFile(envPath);

  const stripeKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  const vercelWhsec = String(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const prodBase = String(process.env.PROD_BASE_URL ?? "https://www.mmddelivery.com").replace(
    /\/$/,
    "",
  );

  const report = {
    block: "B2",
    validatedAt: new Date().toISOString(),
    canonicalUrl: CANONICAL_URL,
    requiredEvents: REQUIRED_EVENTS,
    stripeApiMode: stripeKey.startsWith("sk_live_")
      ? "live"
      : stripeKey.startsWith("sk_test_")
        ? "test"
        : "missing",
    endpoints: [],
    endpointCount: null,
    urlMatch: false,
    noSupabaseEdgeUrl: true,
    subscribedEvents: [],
    missingRequiredEvents: [],
    vercelSecret: {
      present: Boolean(vercelWhsec),
      tail4: tail4(vercelWhsec),
      cliReadable: Boolean(vercelWhsec),
    },
    stripeSigningSecret: {
      present: false,
      tail4: null,
      matchesVercel: null,
      note: null,
    },
    healthCheck: {
      url: `${prodBase}/api/health/stripe-webhook`,
      httpStatus: null,
      ok: false,
      canonical_webhook_url: null,
      edge_webhook_must_be_disabled: null,
      error: null,
    },
    runtimeProbe: {
      url: `${prodBase}/api/stripe/webhook`,
      httpStatus: null,
      secretConfigured: false,
      error: null,
    },
    manualSignOff: {
      STRIPE_DASHBOARD_CHECK_DONE: truthy(process.env.STRIPE_DASHBOARD_CHECK_DONE),
      STRIPE_UNIQUE_WEBHOOK_CONFIRMED: truthy(process.env.STRIPE_UNIQUE_WEBHOOK_CONFIRMED),
    },
    verificationMode: "pending",
    blockers: [],
    verdict: "FAIL",
  };

  const manualSignOffReady =
    report.manualSignOff.STRIPE_DASHBOARD_CHECK_DONE &&
    report.manualSignOff.STRIPE_UNIQUE_WEBHOOK_CONFIRMED;

  const stripeApiBlockers = [];

  if (stripeKey.startsWith("sk_live_")) {
    report.verificationMode = "automated_stripe_api";
    const list = await stripeGet("/webhook_endpoints?limit=100", stripeKey);
    const active = (list.data ?? []).filter((e) => e.status !== "disabled");
    report.endpointCount = active.length;
    report.endpoints = active.map((e) => ({
      id: e.id,
      url: e.url,
      status: e.status,
      enabled_events: e.enabled_events,
      api_version: e.api_version,
    }));

    const canonical = active.filter((e) => e.url === CANONICAL_URL);
    report.urlMatch = canonical.length === 1 && active.length === 1;

    const edgeUrls = active.filter((e) =>
      /supabase\.co\/functions\/v1\/stripe_webhook/i.test(e.url ?? ""),
    );
    report.noSupabaseEdgeUrl = edgeUrls.length === 0;
    if (edgeUrls.length > 0) {
      stripeApiBlockers.push(
        `Supabase Edge webhook URL found: ${edgeUrls.map((e) => e.url).join(", ")}`,
      );
    }

    if (active.length !== 1) {
      stripeApiBlockers.push(`Expected exactly 1 active Live endpoint, found ${active.length}`);
    } else if (active[0].url !== CANONICAL_URL) {
      stripeApiBlockers.push(`Active endpoint URL is ${active[0].url}, not canonical`);
    }

    const enabledEvents =
      active[0]?.enabled_events?.length === 1 && active[0].enabled_events[0] === "*"
        ? ["* (all events)"]
        : (active[0]?.enabled_events ?? []);
    report.subscribedEvents = enabledEvents;

    const hasAll =
      enabledEvents[0] === "* (all events)" ||
      REQUIRED_EVENTS.every((ev) => enabledEvents.includes(ev));
    report.missingRequiredEvents = hasAll
      ? []
      : REQUIRED_EVENTS.filter((ev) => !enabledEvents.includes(ev));
    if (report.missingRequiredEvents.length > 0) {
      stripeApiBlockers.push(
        `Missing subscribed events: ${report.missingRequiredEvents.join(", ")}`,
      );
    }

    if (canonical[0]?.id) {
      const detail = await stripeGet(`/webhook_endpoints/${canonical[0].id}`, stripeKey);
      const whsec = String(detail.secret ?? "").trim();
      report.stripeSigningSecret.present = Boolean(whsec);
      report.stripeSigningSecret.tail4 = tail4(whsec);
      if (vercelWhsec && whsec) {
        report.stripeSigningSecret.matchesVercel = whsec === vercelWhsec;
        if (!report.stripeSigningSecret.matchesVercel) {
          stripeApiBlockers.push(
            `STRIPE_WEBHOOK_SECRET mismatch (Vercel …${tail4(vercelWhsec)} vs Stripe …${tail4(whsec)})`,
          );
        }
      } else if (!vercelWhsec) {
        report.stripeSigningSecret.note =
          "STRIPE_WEBHOOK_SECRET not readable via CLI (Vercel Sensitive) — runtime probe used";
      }
    }
  } else if (manualSignOffReady) {
    report.verificationMode = "manual_dashboard_signoff";
    report.endpointCount = 1;
    report.urlMatch = true;
    report.noSupabaseEdgeUrl = true;
    report.subscribedEvents = [...REQUIRED_EVENTS];
    report.missingRequiredEvents = [];
    report.endpoints = [
      {
        id: "manual:MMD Delivery Production Webhook",
        url: CANONICAL_URL,
        status: "enabled",
        enabled_events: REQUIRED_EVENTS,
      },
    ];
    report.stripeSigningSecret.note =
      "Not compared via CLI (Vercel Sensitive) — runtime probe used instead";
  } else {
    report.verificationMode = "incomplete";
    stripeApiBlockers.push(
      stripeKey
        ? "STRIPE_SECRET_KEY is not sk_live_* — cannot verify Live Dashboard webhooks"
        : "STRIPE_SECRET_KEY missing — set sk_live_* in env or STRIPE_DASHBOARD_CHECK_DONE=true after manual Dashboard review",
    );
  }

  const healthHeaders = cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
  try {
    const hres = await fetch(report.healthCheck.url, { headers: healthHeaders });
    report.healthCheck.httpStatus = hres.status;
    const hbody = await hres.json().catch(() => ({}));
    if (hres.status === 401) {
      report.healthCheck.error = "Unauthorized — CRON_SECRET required for production health probe";
      report.blockers.push("Health check returned 401 — set CRON_SECRET (production value)");
    } else if (hres.ok) {
      report.healthCheck.canonical_webhook_url = hbody.canonical_webhook_url ?? null;
      report.healthCheck.edge_webhook_must_be_disabled = hbody.edge_webhook_must_be_disabled ?? null;
      report.healthCheck.ok =
        hbody.canonical_webhook_url === CANONICAL_URL &&
        hbody.edge_webhook_must_be_disabled === true;
      if (!report.healthCheck.ok) {
        report.blockers.push("Health JSON does not match expected canonical/disabled flags");
      }
    } else {
      report.healthCheck.error = hbody?.error ?? `HTTP ${hres.status}`;
      report.blockers.push(`Health check failed: HTTP ${hres.status}`);
    }
  } catch (e) {
    report.healthCheck.error = e instanceof Error ? e.message : String(e);
    report.blockers.push(`Health check request failed: ${report.healthCheck.error}`);
  }

  const runtimeProbe = await probeRuntimeWebhookSecret(prodBase);
  report.runtimeProbe.httpStatus = runtimeProbe.httpStatus;
  report.runtimeProbe.secretConfigured = runtimeProbe.secretConfigured;
  report.runtimeProbe.error = runtimeProbe.error;
  if (!runtimeProbe.secretConfigured) {
    report.blockers.push(
      `Runtime webhook probe failed — expected 400 Missing stripe-signature, got HTTP ${runtimeProbe.httpStatus ?? "error"}`,
    );
  }

  report.blockers.push(...stripeApiBlockers);

  const automatedStripePass =
    report.verificationMode === "automated_stripe_api" &&
    report.endpointCount === 1 &&
    report.urlMatch &&
    report.noSupabaseEdgeUrl &&
    report.missingRequiredEvents.length === 0 &&
    (report.stripeSigningSecret.matchesVercel === true ||
      (report.stripeSigningSecret.note && runtimeProbe.secretConfigured));

  const manualStripePass =
    report.verificationMode === "manual_dashboard_signoff" &&
    report.endpointCount === 1 &&
    report.urlMatch &&
    report.noSupabaseEdgeUrl &&
    report.missingRequiredEvents.length === 0 &&
    runtimeProbe.secretConfigured;

  if (manualStripePass) {
    report.blockers = report.blockers.filter(
      (b) =>
        !b.includes("STRIPE_SECRET_KEY") &&
        !b.includes("STRIPE_WEBHOOK_SECRET missing"),
    );
  }

  const pass =
    report.blockers.length === 0 &&
    (automatedStripePass || manualStripePass) &&
    report.healthCheck.ok === true &&
    runtimeProbe.secretConfigured;

  report.verdict = pass ? "PASS" : "FAIL";

  const outDir = join(root, "docs/production/reports/ops-b1-b6/B2");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "b2-certification-report.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
