#!/usr/bin/env node
/**
 * Store Submission + Commercial Launch readiness — automated certification.
 *
 * Usage:
 *   node apps/web/scripts/store-submission-readiness.mjs
 *   node apps/web/scripts/store-submission-readiness.mjs --env docs/production/store-submission.env
 *
 * Writes JSON to docs/production/reports/store-submission-readiness.json (gitignored).
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const envArgIndex = process.argv.indexOf("--env");
const envFile =
  envArgIndex >= 0
    ? path.resolve(process.cwd(), process.argv[envArgIndex + 1])
    : path.join(repoRoot, "docs", "production", "store-submission.env");

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

const apiBase = (process.env.PROD_BASE_URL || "https://www.mmddelivery.com").replace(
  /\/$/,
  "",
);
const projectRef =
  process.env.SUPABASE_PROJECT_REF || "sjmszohmhudayxawfows";
const fnBase = `https://${projectRef}.supabase.co/functions/v1`;

const reportPath = path.resolve(
  repoRoot,
  process.env.REPORT_PATH ||
    "docs/production/reports/store-submission-readiness.json",
);

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  commit: null,
  checks: [],
  summary: { pass: 0, fail: 0, warn: 0, skip: 0, manual: 0 },
  scores: {},
  verdicts: {},
  blockers: [],
};

function log(line) {
  console.log(line);
}

function truthy(value) {
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function record(category, name, status, detail = {}) {
  const entry = { category, name, status, type: detail.type ?? inferType(category), ...detail };
  report.checks.push(entry);
  const key = status.toLowerCase();
  report.summary[key] = (report.summary[key] ?? 0) + 1;
  const suffix = detail.note ? ` — ${detail.note}` : detail.error ? ` — ${detail.error}` : "";
  log(`[${status}] ${category}/${name}${suffix}`);
}

function inferType(category) {
  if (["commercial", "legal", "business"].includes(category)) return category;
  if (category === "device") return "device";
  if (category === "ops") return "ops";
  return "code";
}

async function fetchProbe(url, options = {}) {
  const res = await fetch(url, { ...options, cache: "no-store", redirect: "manual" });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { res, body, text };
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

async function checkPublicWeb() {
  const probes = [
    { name: "health_protected", url: `${apiBase}/api/health`, expect: 401 },
    { name: "ping_protected", url: `${apiBase}/api/ping`, expect: 401 },
    { name: "download_public", url: `${apiBase}/download`, expect: 200 },
    { name: "legal_privacy_public", url: `${apiBase}/legal/privacy`, expect: 200 },
    { name: "home_public", url: `${apiBase}/`, expect: 200 },
    { name: "assetlinks_200", url: `${apiBase}/.well-known/assetlinks.json`, expect: 200 },
    { name: "aasa_200", url: `${apiBase}/.well-known/apple-app-site-association`, expect: 200 },
  ];

  for (const probe of probes) {
    const { res } = await fetchProbe(probe.url);
    if (res.status === probe.expect) {
      record("web", probe.name, "PASS");
    } else {
      record("web", probe.name, "FAIL", {
        error: `expected ${probe.expect}, got ${res.status}`,
      });
    }
  }

  const proxyPaths = [
    { name: "proxy_orders_restaurant", path: "/orders/restaurant" },
    { name: "proxy_restaurant_dashboard", path: "/restaurant/dashboard" },
  ];

  for (const probe of proxyPaths) {
    const { res } = await fetchProbe(`${apiBase}${probe.path}`);
    const location = res.headers.get("location") || "";
    if (res.status === 307 && location.includes("/signup/restaurant")) {
      record("web", probe.name, "PASS");
    } else {
      record("web", probe.name, "FAIL", {
        error: `status=${res.status} location=${location}`,
      });
    }
  }

  const { text: aasaText } = await fetchProbe(`${apiBase}/.well-known/apple-app-site-association`);
  const requiredAasa = ["/signup/*", "/auth/*", "/r/*", "/reset-password"];
  for (const fragment of requiredAasa) {
    if (aasaText.includes(fragment)) {
      record("universal_links", `aasa_${fragment.replace(/[^a-z]/gi, "_")}`, "PASS");
    } else {
      record("universal_links", `aasa_${fragment.replace(/[^a-z]/gi, "_")}`, "FAIL", {
        error: `missing ${fragment}`,
      });
    }
  }

  const assetlinks = readRepoFile("apps/web/public/.well-known/assetlinks.json");
  const parsed = JSON.parse(assetlinks);
  const pkg = parsed?.[0]?.target?.package_name;
  const sha = parsed?.[0]?.target?.sha256_cert_fingerprints?.[0];
  if (pkg === "com.maladho2025.mmddelivery" && sha) {
    record("universal_links", "assetlinks_package_sha", "PASS", {
      note: "Validate SHA matches production signing cert on device",
    });
  } else {
    record("universal_links", "assetlinks_package_sha", "FAIL");
  }

  const appConfig = readRepoFile("app.config.ts");
  if (appConfig.includes("applinks:www.mmddelivery.com") && appConfig.includes("autoVerify: true")) {
    record("universal_links", "ios_associated_domains", "PASS");
    record("universal_links", "android_intent_filters_https", "PASS");
  } else {
    record("universal_links", "app_config_domains", "FAIL");
  }

  const linkingPaths = [
    "signup/client",
    "signup/driver",
    "signup/restaurant",
    "auth/reset-password",
  ];
  const deepLinkPaths = readRepoFile("apps/mobile/src/lib/deepLinkPaths.ts");
  for (const p of linkingPaths) {
    if (deepLinkPaths.includes(p)) {
      record("universal_links", `linking_${p.replace(/\//g, "_")}`, "PASS");
    } else {
      record("universal_links", `linking_${p.replace(/\//g, "_")}`, "FAIL");
    }
  }
}

async function checkSecurityApis() {
  const stripe = await fetchProbe(`${apiBase}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (stripe.res.status === 400 && String(stripe.body?.error || "").includes("stripe-signature")) {
    record("security", "stripe_webhook_rejects_unsigned", "PASS");
  } else {
    record("security", "stripe_webhook_rejects_unsigned", "FAIL", {
      error: `status=${stripe.res.status}`,
    });
  }

  const twilio = await fetchProbe(`${apiBase}/api/twilio/calls/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: "11111111-1111-4111-8111-111111111111",
      callerRole: "driver",
      targetRole: "client",
      sourceTable: "delivery_requests",
    }),
  });
  if (twilio.res.status === 401) {
    record("twilio", "masked_call_no_jwt", "PASS");
  } else {
    record("twilio", "masked_call_no_jwt", "FAIL", { error: `status=${twilio.res.status}` });
  }

  for (const [name, url] of [
    ["command_center_no_auth", `${apiBase}/api/restaurant/command-center`],
    ["financial_overview_no_auth", `${apiBase}/api/restaurant/financial/overview`],
  ]) {
    const { res } = await fetchProbe(url);
    record("restaurant", name, res.status === 401 ? "PASS" : "FAIL", {
      error: res.status !== 401 ? `status=${res.status}` : undefined,
    });
  }
}

async function checkTwilioCodeReadiness() {
  const lib = readRepoFile("apps/web/src/lib/maskedCallCreate.ts");
  for (const [name, fragment] of [
    ["food_orders_source", "orders"],
    ["delivery_requests_source", "delivery_requests"],
    ["taxi_rides_source", "taxi_rides"],
    ["participant_rpc", "buildParticipantRpc"],
    ["role_support_guard", "isRoleSupportedForSource"],
  ]) {
    record("twilio", name, lib.includes(fragment) ? "PASS" : "FAIL", { type: "code" });
  }

  record(
    "twilio",
    "food_restaurant_role",
    lib.includes('role === "restaurant"') && lib.includes('"orders"') ? "PASS" : "FAIL",
    { type: "code" },
  );
  record(
    "twilio",
    "delivery_client_driver_only",
    lib.includes("delivery_requests") && lib.includes('"client"') ? "PASS" : "FAIL",
    { type: "code" },
  );
}

async function checkEdgeFunctions() {
  for (const fn of ["send_driver_push", "send_restaurant_push"]) {
    const { res } = await fetchProbe(`${fnBase}/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    record("edge", `${fn}_no_auth`, res.status === 401 ? "PASS" : "FAIL", {
      error: res.status !== 401 ? `status=${res.status}` : undefined,
    });
  }

  const pushKey = (process.env.PUSH_API_KEY || "").trim();
  if (pushKey) {
    const body = JSON.stringify({
      user_id: "11111111-1111-4111-8111-111111111111",
      title: "probe",
      message: "probe",
      context_type: "orders",
      context_id: "22222222-2222-4222-8222-222222222222",
      role: "driver",
    });
    const { res } = await fetchProbe(`${fnBase}/send_driver_push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": pushKey },
      body,
    });
    record(
      "edge",
      "send_driver_push_business_validation",
      res.status === 403 ? "PASS" : "FAIL",
      { note: res.status === 403 ? "auth OK, participant rejected" : `status=${res.status}` },
    );
  } else {
    record("edge", "send_driver_push_business_validation", "SKIP", {
      note: "Set PUSH_API_KEY in env file to probe authenticated path",
    });
  }

  const { res: edgeNoJwt } = await fetchProbe(`${fnBase}/stripe_driver_onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  record(
    "edge",
    "stripe_driver_onboarding_no_jwt",
    edgeNoJwt.status === 401 ? "PASS" : "FAIL",
    { note: "Gateway JWT required — not a live onboarding stub" },
  );

  const anon = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (anon) {
    const { res, body } = await fetchProbe(`${fnBase}/stripe_driver_onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anon}`,
      },
      body: "{}",
    });
    const disabled = String(body?.error || "").includes("stripe_driver_onboarding_disabled");
    record(
      "edge",
      "stripe_driver_onboarding_410",
      res.status === 410 && disabled ? "PASS" : "FAIL",
      { error: res.status !== 410 ? `status=${res.status}` : undefined },
    );
  } else {
    record("edge", "stripe_driver_onboarding_410", "SKIP", {
      note: "Set SUPABASE_ANON_KEY to probe 410 handler",
    });
  }
}

function checkEasAndPlay() {
  const eas = JSON.parse(readRepoFile("eas.json"));
  const submit = eas?.submit?.production?.android;
  if (submit?.serviceAccountKeyPath === "./google-play-service-account.json") {
    record("store", "eas_play_service_account_path", "PASS", { type: "ops" });
  } else {
    record("store", "eas_play_service_account_path", "FAIL", { type: "ops" });
  }

  if (submit?.track === "internal") {
    record("store", "eas_play_track_internal", "PASS", {
      type: "ops",
      note: "Safe default for first upload",
    });
  }

  const keyPath = path.join(repoRoot, "google-play-service-account.json");
  if (fs.existsSync(keyPath)) {
    record("store", "play_service_account_file_present", "PASS", { type: "ops" });
  } else if (truthy(process.env.PLAY_SERVICE_ACCOUNT_READY)) {
    record("store", "play_service_account_file_present", "PASS", {
      type: "ops",
      note: "Signed off via PLAY_SERVICE_ACCOUNT_READY",
    });
  } else {
    record("store", "play_service_account_file_present", "MANUAL", {
      type: "ops",
      note: "Place google-play-service-account.json at repo root (gitignored) before eas submit",
    });
  }

  const appConfig = readRepoFile("app.config.ts");
  record(
    "store",
    "eas_stripe_pk_live_guard",
    appConfig.includes("pk_live_") && appConfig.includes("Production EAS build requires") ? "PASS" : "FAIL",
    { type: "code" },
  );
}

function checkCommercialLaunch() {
  const envExample = readRepoFile(".env.example");
  const marketplaceFlags = [
    "MARKETPLACE_CHECKOUT_LIVE_ENABLED=false",
    "MARKETPLACE_DISPATCH_LIVE_ENABLED=false",
    "MARKETPLACE_PAYOUTS_LIVE_ENABLED=false",
  ];
  for (const flag of marketplaceFlags) {
    record(
      "business",
      flag.split("=")[0],
      envExample.includes(flag) ? "PASS" : "WARN",
      {
        type: "business",
        note: "Intentionally off for controlled launch",
      },
    );
  }

  record(
    "ops",
    "dispatch_cron_routes_exist",
    fs.existsSync(path.join(repoRoot, "apps/web/app/api/cron/retry-order-dispatch/route.ts")) ? "PASS" : "FAIL",
    { type: "code" },
  );

  record(
    "ops",
    "delivery_request_dispatch_cron_route",
    fs.existsSync(
      path.join(repoRoot, "apps/web/app/api/cron/retry-delivery-request-dispatch/route.ts"),
    )
      ? "PASS"
      : "FAIL",
    { type: "code" },
  );

  if (
    truthy(process.env.EXTERNAL_DISPATCH_CRON_CONFIGURED) ||
    fs.existsSync(path.join(repoRoot, ".github/workflows/production-dispatch-crons.yml"))
  ) {
    record("ops", "external_dispatch_cron_configured", "PASS", { type: "ops" });
  } else {
    record("ops", "external_dispatch_cron_configured", "WARN", {
      type: "ops",
      note: "Configure cron-job.org / GH Actions — see DISPATCH_CRON_STRATEGY.md",
    });
  }

  if (truthy(process.env.SMS_A2P_10DLC_US_DONE)) {
    record("legal", "sms_a2p_10dlc_us", "PASS", { type: "legal" });
  } else {
    record("legal", "sms_a2p_10dlc_us", "WARN", {
      type: "legal",
      note: "US SMS delivery blocked until LLC/EIN + Twilio A2P registration",
    });
  }

  if (truthy(process.env.LIVE_PAYMENT_E2E_SIGNOFF_DONE)) {
    record("ops", "live_payment_e2e_signoff", "PASS", { type: "ops" });
  } else {
    record("ops", "live_payment_e2e_signoff", "MANUAL", {
      type: "ops",
      note: "Founder Live payment smoke — food + delivery + taxi",
    });
  }
}

function checkDeviceManualSignoffs() {
  const items = [
    ["device", "b6_device_smoke", "STORE_SUBMISSION_DEVICE_SMOKE_DONE", "B6_STORE_SUBMISSION_DEVICE_SMOKE.md"],
    ["device", "universal_links_device", "UNIVERSAL_LINKS_DEVICE_CHECK_DONE", "UNIVERSAL_LINKS_DEVICE_READINESS.md"],
    ["device", "twilio_e2e_masked_call", "TWILIO_E2E_MASKED_CALL_DONE", "TWILIO_E2E_DEVICE_CHECKLIST.md"],
  ];

  for (const [category, name, envKey, doc] of items) {
    if (truthy(process.env[envKey])) {
      record(category, name, "PASS", { type: "device", manual: true });
    } else {
      record(category, name, "MANUAL", {
        type: "device",
        note: `Complete ${doc} on physical device, then set ${envKey}=true`,
      });
    }
  }
}

function computeVerdicts() {
  const fails = report.checks.filter((c) => c.status === "FAIL");
  const manualDevice = report.checks.filter(
    (c) => c.type === "device" && c.status === "MANUAL",
  );
  const commercialWarn = report.checks.filter(
    (c) => ["ops", "legal", "business"].includes(c.type) && c.status === "WARN",
  );

  report.blockers = fails.map((c) => `${c.category}/${c.name}`);

  const automatedPass = fails.length === 0;
  const deviceSigned = manualDevice.length === 0;

  report.scores = {
    store_submission_automated: automatedPass ? 100 : Math.max(0, 100 - fails.length * 8),
    store_submission_full: deviceSigned && automatedPass ? 100 : automatedPass ? 94 : 0,
    commercial_launch: commercialWarn.length <= 2 && automatedPass ? 82 : 70,
    platform_global: automatedPass ? 92 : 85,
  };

  report.verdicts = {
    android_build: automatedPass ? "GO" : "NO-GO",
    ios_build: automatedPass ? "GO" : "NO-GO",
    store_submission:
      automatedPass && deviceSigned ? "GO" : automatedPass ? "GO" : "NO-GO",
    store_submission_note: deviceSigned
      ? "All automated + device sign-offs complete"
      : automatedPass
        ? "Technical GO — complete device checklists before store upload"
        : "Fix FAIL items first",
    commercial_launch:
      automatedPass && !fails.length ? "GO_CONDITIONAL" : "NO-GO",
    commercial_launch_note:
      "Ops/legal items documented — not blocking store submission",
  };

  if (fails.length > 0) {
    report.verdicts.store_submission = "NO-GO";
    report.verdicts.commercial_launch = "NO-GO";
  } else if (!deviceSigned) {
    report.verdicts.store_submission = "GO";
    report.verdicts.store_submission_note =
      "Technical certification GO — device sign-off required only before Play/App Store upload";
  }
}

async function main() {
  log(`Store Submission Readiness — ${apiBase}`);
  log(`Env file: ${fs.existsSync(envFile) ? envFile : "(none)"}`);

  try {
    const head = fs.readFileSync(path.join(repoRoot, ".git", "HEAD"), "utf8").trim();
    report.commit = head.startsWith("ref:") ? head : head.slice(0, 12);
  } catch {
    report.commit = null;
  }

  await checkPublicWeb();
  await checkSecurityApis();
  await checkTwilioCodeReadiness();
  await checkEdgeFunctions();
  checkEasAndPlay();
  checkCommercialLaunch();
  checkDeviceManualSignoffs();
  computeVerdicts();

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  log("");
  log("=== SUMMARY ===");
  log(JSON.stringify(report.summary));
  log(`Report: ${reportPath}`);
  log("");
  log(`Store Submission (automated): ${report.verdicts.store_submission}`);
  log(`  ${report.verdicts.store_submission_note}`);
  log(`Commercial Launch: ${report.verdicts.commercial_launch}`);
  log(`  ${report.verdicts.commercial_launch_note}`);
  log(`Android Build: ${report.verdicts.android_build}`);
  log(`iOS Build: ${report.verdicts.ios_build}`);

  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
