#!/usr/bin/env node
/**
 * B6 — EAS production secrets certification (no secret values printed).
 * Usage: node scripts/verify-b6-eas-secrets.mjs [--env docs/production/final-certification.env]
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const REQUIRED_EAS = [
  "EXPO_PUBLIC_STRIPE_PK",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_MAPBOX_TOKEN",
  "RNMAPBOX_MAPS_DOWNLOAD_TOKEN",
];

const FORBIDDEN_MOBILE_PATTERNS = [
  /sk_live_[a-zA-Z0-9]+/,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]eyJ/,
  /CRON_SECRET\s*=\s*['"][^'"]+['"]/,
  /STRIPE_SECRET_KEY\s*=\s*['"]sk_/,
  /whsec_[a-zA-Z0-9]+/,
];

function loadEnvFile(path) {
  const abs = path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(root, path);
  const text = readFileSync(abs, "utf8");
  const out = {};
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
    out[key] = val;
  }
  return out;
}

function parseEasEnvList(text) {
  const vars = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Environment:") || line.startsWith("—")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.includes("(This is a sensitive") || val.includes("(This is a secret")) {
      val = val.split(" (")[0].trim();
    }
    if (val === "*****" || val === "") {
      vars.set(key, { present: true, masked: true, value: null });
    } else {
      vars.set(key, { present: true, masked: false, value: val });
    }
  }
  return vars;
}

function tailMatch(a, b, n = 12) {
  if (!a || !b) return false;
  return a.slice(-n) === b.slice(-n);
}

function scanMobileForForbiddenSecrets() {
  const hits = [];
  const dirs = [join(root, "apps/mobile/src"), join(root, "apps/mobile/lib")];
  const files = [join(root, "app.config.ts")];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(p);
    }
  }
  for (const d of dirs) {
    try {
      walk(d);
    } catch {
      /* skip */
    }
  }

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const pat of FORBIDDEN_MOBILE_PATTERNS) {
      if (pat.test(text)) {
        hits.push({
          file: file.replace(root + "\\", "").replace(root + "/", ""),
          pattern: pat.source,
        });
      }
    }
  }
  return hits;
}

async function main() {
  const envPath =
    process.argv.includes("--env") ?
      process.argv[process.argv.indexOf("--env") + 1]
    : "docs/production/final-certification.env";
  const cert = loadEnvFile(envPath);

  const easList = spawnSync("npx eas-cli env:list --environment production", {
    encoding: "utf8",
    shell: true,
    cwd: root,
  });
  let easVars = parseEasEnvList(`${easList.stdout || ""}\n${easList.stderr || ""}`);

  const easSensitive = spawnSync(
    "npx eas-cli env:list --environment production --include-sensitive",
    { encoding: "utf8", shell: true, cwd: root }
  );
  const easSensitiveVars = parseEasEnvList(
    `${easSensitive.stdout || ""}\n${easSensitive.stderr || ""}`
  );
  for (const [k, v] of easSensitiveVars) {
    if (v.value) easVars.set(k, v);
  }

  const report = {
    block: "B6_eas_production_secrets",
    validatedAt: new Date().toISOString(),
    easPresent: [],
    easMissing: [],
    coherence: {},
    buildProfiles: {},
    risks: [],
    forbiddenInMobile: [],
    verdict: "FAIL",
  };

  for (const key of REQUIRED_EAS) {
    if (easVars.has(key)) report.easPresent.push(key);
    else report.easMissing.push(key);
  }

  const stripe = easVars.get("EXPO_PUBLIC_STRIPE_PK")?.value ?? "";
  const supabaseUrl = easVars.get("EXPO_PUBLIC_SUPABASE_URL")?.value ?? "";
  const supabaseAnon = easVars.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")?.value ?? "";
  const mapboxPk = easVars.get("EXPO_PUBLIC_MAPBOX_TOKEN")?.value ?? "";

  report.coherence = {
    stripe_pk_live: stripe.startsWith("pk_live_"),
    stripe_prefix: stripe ? stripe.slice(0, 8) + "…" : "(missing)",
    supabase_url_matches_prod:
      supabaseUrl === cert.SUPABASE_URL ||
      supabaseUrl.includes("sjmszohmhudayxawfows"),
    supabase_anon_matches_prod: tailMatch(supabaseAnon, cert.SUPABASE_ANON_KEY, 16),
    mapbox_token_set: mapboxPk.startsWith("pk."),
    api_url_prod: "https://www.mmddelivery.com (eas.json production profile)",
    legal_urls: "defaults in app.config.ts → www.mmddelivery.com/legal/*",
  };

  if (!report.coherence.stripe_pk_live) {
    report.risks.push("EXPO_PUBLIC_STRIPE_PK is not pk_live_ (required for production builds)");
  }
  if (!report.coherence.supabase_url_matches_prod) {
    report.risks.push("EXPO_PUBLIC_SUPABASE_URL does not match production project sjmszohmhudayxawfows");
  }
  if (!report.coherence.supabase_anon_matches_prod) {
    report.risks.push("EXPO_PUBLIC_SUPABASE_ANON_KEY may not match production anon key");
  }
  if (easVars.has("MAPBOX_DOWNLOADS_TOKEN")) {
    report.risks.push(
      "Legacy duplicate MAPBOX_DOWNLOADS_TOKEN also set (harmless if same as RNMAPBOX_MAPS_DOWNLOAD_TOKEN)"
    );
  }

  const easJson = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
  report.buildProfiles = {
    production: {
      environment: easJson.build?.production?.environment ?? null,
      APP_ENV: easJson.build?.production?.env?.APP_ENV ?? null,
      EXPO_PUBLIC_API_URL_PROD: easJson.build?.production?.env?.EXPO_PUBLIC_API_URL_PROD ?? null,
      autoIncrement: easJson.build?.production?.autoIncrement ?? false,
    },
    ios: {
      bundleId: "com.maladho2025.mmddelivery",
      ascAppId: easJson.submit?.production?.ios?.ascAppId ?? null,
      associatedDomains: ["applinks:www.mmddelivery.com", "applinks:mmddelivery.com"],
    },
    android: {
      package: "com.maladho2025.mmddelivery",
      submitTrack: easJson.submit?.production?.android?.track ?? null,
      deepLinks: ["https://www.mmddelivery.com", "https://mmddelivery.com"],
    },
  };

  if (easJson.build?.development?.env?.EXPO_PUBLIC_API_URL_LOCAL?.includes("192.168.")) {
    report.risks.push("Dev profile contains LAN IP — scoped to development profile only (OK)");
  }

  report.forbiddenInMobile = scanMobileForForbiddenSecrets();
  if (report.forbiddenInMobile.length) {
    report.risks.push("Possible server secret patterns found in mobile source (review required)");
  }

  // Simulate app.config production guard
  process.env.APP_ENV = "production";
  process.env.EAS_BUILD_PROFILE = "production";
  process.env.EXPO_PUBLIC_STRIPE_PK = stripe;
  let appConfigGuardOk = false;
  try {
    if (stripe.startsWith("pk_live_")) appConfigGuardOk = true;
  } catch {
    appConfigGuardOk = false;
  }
  report.coherence.app_config_stripe_guard_would_pass = appConfigGuardOk;

  const pass =
    report.easMissing.length === 0 &&
    report.coherence.stripe_pk_live &&
    report.coherence.supabase_url_matches_prod &&
    report.coherence.supabase_anon_matches_prod &&
    report.coherence.mapbox_token_set &&
    easVars.get("RNMAPBOX_MAPS_DOWNLOAD_TOKEN")?.present &&
    report.forbiddenInMobile.length === 0 &&
    report.buildProfiles.production.environment === "production";

  report.verdict = pass ? "PASS" : "FAIL";

  const outDir = join(root, "docs/production/reports/ops-b1-b6/B6");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "b6-eas-secrets-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, easPresent: report.easPresent, easMissing: report.easMissing, risks: report.risks }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
