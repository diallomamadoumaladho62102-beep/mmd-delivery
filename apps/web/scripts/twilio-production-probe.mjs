#!/usr/bin/env node
/**
 * Twilio production configuration probe (no secrets printed).
 *
 * Usage:
 *   node apps/web/scripts/twilio-production-probe.mjs
 *   node apps/web/scripts/twilio-production-probe.mjs --env apps/web/.env.local
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const envArgIndex = process.argv.indexOf("--env");
const envFile =
  envArgIndex >= 0
    ? path.resolve(process.cwd(), process.argv[envArgIndex + 1])
    : path.join(__dirname, "..", ".env.local");

dotenv.config({ path: envFile });

const apiBase = (
  process.env.TWILIO_WEBHOOK_BASE_URL ||
  process.env.PROD_BASE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  checks: [],
  summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
};

function record(name, status, note = "") {
  report.checks.push({ name, status, note });
  report.summary[status.toLowerCase()] = (report.summary[status.toLowerCase()] ?? 0) + 1;
  console.log(`[${status}] ${name}${note ? ` — ${note}` : ""}`);
}

function maskPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "(hidden)";
  return `***${digits.slice(-4)}`;
}

function checkEnv(name, aliases = []) {
  const keys = [name, ...aliases];
  const found = keys.find((key) => String(process.env[key] ?? "").trim());
  if (found) {
    record(`env_${name.toLowerCase()}`, "PASS", `set via ${found}`);
    return true;
  }
  record(`env_${name.toLowerCase()}`, "FAIL", "missing");
  return false;
}

async function fetchStatus(url, method = "GET") {
  const res = await fetch(url, { method, redirect: "manual", cache: "no-store" });
  return res.status;
}

async function twilioApi(pathname) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!sid || !token) return null;

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01${pathname}`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  return { ok: true, data: await res.json() };
}

async function main() {
  console.log("Twilio production probe — secrets are never printed.\n");

  checkEnv("TWILIO_ACCOUNT_SID");
  checkEnv("TWILIO_AUTH_TOKEN");
  const hasPhone = checkEnv("TWILIO_PHONE_NUMBER", ["MMD_TWILIO_PHONE_NUMBER", "TWILIO_SMS_FROM"]);
  checkEnv("TWILIO_WEBHOOK_BASE_URL");

  const incomingUrl = `${apiBase}/api/twilio/voice/incoming`;
  const statusUrl = `${apiBase}/api/twilio/voice/status`;
  const legacyVoiceUrl = `${apiBase}/api/twilio/voice`;

  const incomingStatus = await fetchStatus(incomingUrl, "GET");
  if (incomingStatus === 405) {
    record("webhook_incoming_route", "PASS", "POST-only (deployed)");
  } else if (incomingStatus === 404) {
    record("webhook_incoming_route", "FAIL", "404 — deploy /api/twilio/voice/incoming");
  } else {
    record("webhook_incoming_route", "WARN", `GET status=${incomingStatus}`);
  }

  const statusRoute = await fetchStatus(statusUrl, "GET");
  if (statusRoute === 405) {
    record("webhook_status_route", "PASS", "POST-only (deployed)");
  } else if (statusRoute === 404) {
    record("webhook_status_route", "FAIL", "404 — deploy /api/twilio/voice/status");
  } else {
    record("webhook_status_route", "WARN", `GET status=${statusRoute}`);
  }

  const legacyRoute = await fetchStatus(legacyVoiceUrl, "GET");
  record(
    "webhook_legacy_voice_route",
    legacyRoute === 405 ? "PASS" : "WARN",
    `GET status=${legacyRoute}`,
  );

  const unsignedStatus = await fetch("https://www.mmddelivery.com/api/twilio/voice/incoming", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "CallSid=CA_probe&From=%2B15550000000",
    cache: "no-store",
  }).then((r) => r.status).catch(() => 0);

  record(
    "webhook_rejects_unsigned_post",
    unsignedStatus === 403 || unsignedStatus === 500 ? "PASS" : "FAIL",
    `status=${unsignedStatus}`,
  );

  const account = await twilioApi(`/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`);
  if (!account) {
    record("twilio_api_account", "SKIP", "TWILIO credentials not available locally");
  } else if (!account.ok) {
    record("twilio_api_account", "FAIL", `HTTP ${account.status}`);
  } else {
    const data = account.data;
    const type = String(data.type ?? "");
    const status = String(data.status ?? "");
    record("twilio_api_account", status === "active" ? "PASS" : "WARN", `status=${status}`);
    record(
      "twilio_account_trial",
      type.toLowerCase() === "trial" ? "WARN" : "PASS",
      type.toLowerCase() === "trial" ? "Trial account — upgrade for production" : `type=${type}`,
    );

    const balance = await twilioApi(`/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Balance.json`);
    if (balance?.ok) {
      record("twilio_balance", "PASS", `currency=${balance.data.currency}`);
    } else {
      record("twilio_balance", "WARN", "balance endpoint unavailable");
    }
  }

  if (hasPhone && account?.ok) {
    const configured = String(
      process.env.TWILIO_PHONE_NUMBER ||
        process.env.MMD_TWILIO_PHONE_NUMBER ||
        process.env.TWILIO_SMS_FROM ||
        "",
    ).trim();

    const numbers = await twilioApi(
      `/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=20`,
    );

    if (numbers?.ok) {
      const items = numbers.data.incoming_phone_numbers ?? [];
      const match = items.find((n) => String(n.phone_number) === configured);
      if (match) {
        record("twilio_number_owned", "PASS", maskPhone(configured));
        const voiceUrl = String(match.voice_url ?? "");
        const smsUrl = String(match.sms_url ?? "");
        record(
          "twilio_voice_webhook_dashboard",
          voiceUrl.includes("/api/twilio/voice/incoming") ? "PASS" : "FAIL",
          voiceUrl ? `configured` : "empty",
        );
        record(
          "twilio_voice_capability",
          match.capabilities?.voice ? "PASS" : "FAIL",
          `voice=${Boolean(match.capabilities?.voice)}`,
        );
        record(
          "twilio_sms_capability",
          match.capabilities?.sms ? "PASS" : "WARN",
          `sms=${Boolean(match.capabilities?.sms)}`,
        );
        record(
          "twilio_sms_webhook_dashboard",
          smsUrl ? "WARN" : "PASS",
          smsUrl ? "SMS webhook configured (admin SMS only if intentional)" : "not configured",
        );
      } else {
        record("twilio_number_owned", "FAIL", `${maskPhone(configured)} not in account numbers`);
      }
    }
  }

  const outPath = path.join(repoRoot, "docs", "production", "reports", "twilio-production-probe.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(report.summary);

  if (report.summary.fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
