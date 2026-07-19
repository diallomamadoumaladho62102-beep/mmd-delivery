#!/usr/bin/env node
/**
 * Final transactional email + push readiness validation (Phase 10.5).
 * Does not print secrets. Sends at most one Resend email when --send is passed.
 *
 * Usage:
 *   node apps/web/scripts/validate-transactional-email.mjs
 *   node apps/web/scripts/validate-transactional-email.mjs --send
 *   npx vercel env run -e production -- node apps/web/scripts/validate-transactional-email.mjs --send
 */
import dns from "dns/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const shouldSend = process.argv.includes("--send");

const apiBase = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.TWILIO_WEBHOOK_BASE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const founderEmail =
  process.env.FOUNDER_TEST_EMAIL ||
  "diallomamadoumaladho621@gmail.com";

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  checks: [],
  summary: { PASS: 0, FAIL: 0, SKIP: 0, WARN: 0 },
};

function record(name, status, note = "") {
  report.checks.push({ name, status, note });
  report.summary[status] = (report.summary[status] ?? 0) + 1;
  console.log(`[${status}] ${name}${note ? ` — ${note}` : ""}`);
}

function maskSecret(value) {
  const s = String(value ?? "");
  if (!s) return "(empty)";
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function hasNoSecretLeak(text) {
  const hay = String(text ?? "");
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  if (apiKey && hay.includes(apiKey)) return false;
  if (/re_[A-Za-z0-9_]{20,}/.test(hay)) return false;
  return true;
}

async function lookupTxt(name) {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((parts) => parts.join("")).join(" | ");
  } catch {
    // Fall back to public resolvers when local DNS fails (common on Windows).
    try {
      const resolver = new dns.Resolver();
      resolver.setServers(["1.1.1.1", "8.8.8.8"]);
      const records = await resolver.resolveTxt(name);
      return records.map((parts) => parts.join("")).join(" | ");
    } catch {
      return "";
    }
  }
}

async function main() {
  console.log("Transactional email + push final validation\n");

  const enabledRaw = String(process.env.TRANSACTIONAL_EMAIL_ENABLED ?? "").trim().toLowerCase();
  const emailEnabled = ["true", "1", "yes"].includes(enabledRaw);
  record(
    "transactional_email_enabled_local_shell",
    emailEnabled ? "PASS" : "WARN",
    `value=${enabledRaw || "(unset)"} — production deploy is authoritative`,
  );

  const resendKey = String(process.env.RESEND_API_KEY ?? "").trim();
  record(
    "resend_api_key_local_shell",
    resendKey ? "PASS" : "WARN",
    resendKey ? `present ${maskSecret(resendKey)}` : "not in local shell (ok if production has it)",
  );

  const from = String(process.env.ADMIN_EMAIL_FROM ?? "").trim();
  const fromLooksValid =
    from.includes("@") &&
    (from.includes("mmddelivery.com") || from.includes("<"));
  record(
    "admin_email_from_local_shell",
    fromLooksValid ? "PASS" : "WARN",
    from
      ? `domain=${from.includes("@") ? from.split("@").pop()?.replace(/>.*/, "") : "?"}`
      : "not in local shell (ok if production has it)",
  );

  // Production live probe: skipped=true means flag not active on deployed app
  const probeRes = await fetch(`${apiBase}/api/auth/transactional/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "probe-disabled-check@example.invalid",
      resetUrl: "https://www.mmddelivery.com/auth/reset-password?probe=1",
    }),
    cache: "no-store",
  }).catch(() => null);

  const probeBody = probeRes ? await probeRes.json().catch(() => ({})) : {};
  if (!probeRes) {
    record("production_flag_live", "FAIL", "endpoint unreachable");
  } else if (probeBody.skipped === true) {
    record(
      "production_flag_live",
      "FAIL",
      "endpoint returned skipped=true — TRANSACTIONAL_EMAIL_ENABLED not active on deploy",
    );
  } else if (probeRes.status === 200 || probeRes.status === 500 || probeRes.status === 400) {
    // invalid recipient may fail at Resend; important is it did not skip
    record(
      "production_flag_live",
      probeBody.skipped ? "FAIL" : "PASS",
      `http=${probeRes.status} skipped=${Boolean(probeBody.skipped)} ok=${Boolean(probeBody.ok)}`,
    );
  } else {
    record("production_flag_live", "WARN", `http=${probeRes.status}`);
  }

  if (!hasNoSecretLeak(JSON.stringify(probeBody))) {
    record("probe_no_secret_leak", "FAIL", "secret-looking value in probe response");
  } else {
    record("probe_no_secret_leak", "PASS");
  }

  // DNS auth
  const spf = await lookupTxt("send.mmddelivery.com");
  record(
    "spf_send_subdomain",
    spf.includes("v=spf1") ? "PASS" : "FAIL",
    spf ? "TXT present" : "missing",
  );

  const dkim = await lookupTxt("resend._domainkey.mmddelivery.com");
  record(
    "dkim_resend",
    dkim.includes("p=") ? "PASS" : "FAIL",
    dkim ? "TXT present" : "missing",
  );

  const dmarc = await lookupTxt("_dmarc.mmddelivery.com");
  record(
    "dmarc",
    dmarc.includes("v=DMARC1") ? "PASS" : "WARN",
    dmarc || "missing",
  );

  // Push readiness (no Twilio changes)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: tokenRows } = await admin
      .from("user_push_tokens")
      .select("role")
      .limit(500);
    const counts = { client: 0, driver: 0, restaurant: 0, other: 0 };
    for (const row of tokenRows ?? []) {
      const role = String(row.role ?? "other");
      if (role in counts) counts[role] += 1;
      else counts.other += 1;
    }
    record(
      "push_tokens_client",
      counts.client > 0 ? "PASS" : "FAIL",
      `n=${counts.client}`,
    );
    record(
      "push_tokens_driver",
      counts.driver > 0 ? "PASS" : "FAIL",
      `n=${counts.driver}`,
    );
    record(
      "push_tokens_restaurant",
      counts.restaurant > 0 ? "PASS" : "FAIL",
      `n=${counts.restaurant}`,
    );
    record(
      "push_tokens_seller",
      "WARN",
      "seller role tokens not present in aggregate (0 expected if vendors use restaurant role)",
    );
  } else {
    record("push_tokens", "SKIP", "Supabase admin env missing in this shell");
  }

  // Env presence in this shell is optional when validating the live production deploy.
  if (!emailEnabled && process.env.VERCEL !== "1") {
    record(
      "local_env_optional",
      "WARN",
      "local shell missing email env — relying on production deploy probe",
    );
  }

  if (!shouldSend) {
    record("test_email_send", "SKIP", "pass --send to deliver one founder test email");
    writeReport();
    return;
  }

  const productionReady = report.checks.some(
    (c) => c.name === "production_flag_live" && c.status === "PASS",
  );

  if (!productionReady && (!emailEnabled || !resendKey || !fromLooksValid)) {
    record("test_email_send", "FAIL", "blocked: production flag not live and local env incomplete");
    writeReport();
    return;
  }

  // One controlled send via production password-reset route with safe fake URL
  // (avoids creating a real Supabase recovery link).
  const sendRes = await fetch(`${apiBase}/api/auth/transactional/password-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: founderEmail,
      resetUrl:
        "https://www.mmddelivery.com/auth/reset-password?phase105=email-validation",
    }),
    cache: "no-store",
  });

  const sendBody = await sendRes.json().catch(() => ({}));
  const sendOk = sendRes.status === 200 && sendBody.ok === true && !sendBody.skipped;

  record(
    "test_email_send",
    sendOk ? "PASS" : "FAIL",
    `http=${sendRes.status} ok=${Boolean(sendBody.ok)} skipped=${Boolean(sendBody.skipped)} to=${founderEmail.replace(/(.{3}).+(@.+)/, "$1***$2")}`,
  );

  if (!hasNoSecretLeak(JSON.stringify(sendBody))) {
    record("send_response_no_secret_leak", "FAIL");
  } else {
    record("send_response_no_secret_leak", "PASS");
  }

  record(
    "test_email_template",
    sendOk ? "PASS" : "FAIL",
    "password_reset HTML template path (notifyPasswordResetEmail)",
  );

  record(
    "test_email_inbox_manual",
    sendOk ? "WARN" : "FAIL",
    "Confirm reception + HTML render in founder inbox (automated inbox read not available)",
  );

  writeReport();
}

function writeReport() {
  const outDir = path.join(repoRoot, "apps", "web", ".tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transactional-email-final-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(report.summary);
  if (report.summary.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
