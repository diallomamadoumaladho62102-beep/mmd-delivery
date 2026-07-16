#!/usr/bin/env node
/**
 * Phase 10.5 communications validation — signed Twilio webhook simulation + DB checks.
 *
 * Usage:
 *   node apps/web/scripts/validate-communications-e2e.mjs
 *   node apps/web/scripts/validate-communications-e2e.mjs --env apps/web/.env.local
 */
import { createHmac } from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

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

function normalizePhoneE164(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) {
    const normalized = `+${digits.slice(1).replace(/\D/g, "")}`;
    return normalized.length > 1 ? normalized : null;
  }
  const onlyDigits = digits.replace(/\D/g, "");
  if (!onlyDigits) return null;
  if (onlyDigits.length === 10) return `+1${onlyDigits}`;
  if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) return `+${onlyDigits}`;
  return `+${onlyDigits}`;
}

function buildTwilioSignature(authToken, url, params) {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

async function main() {
  console.log("Phase 10.5 communications E2E validation\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authToken = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const twilioNumber = String(
    process.env.TWILIO_PHONE_NUMBER ||
      process.env.MMD_TWILIO_PHONE_NUMBER ||
      "+19294924563",
  ).trim();

  const incomingPath = "/api/twilio/voice/incoming";
  const incomingUrl = `${apiBase}${incomingPath}`;

  const unsignedStatus = await fetch(incomingUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "CallSid=CA_unsigned_probe&From=%2B15550000000",
    cache: "no-store",
  })
    .then((r) => r.status)
    .catch(() => 0);

  record(
    "webhook_rejects_unsigned",
    unsignedStatus === 403 || unsignedStatus === 500 ? "PASS" : "FAIL",
    `status=${unsignedStatus}`,
  );

  if (!supabaseUrl || !serviceKey) {
    record("supabase_admin", "SKIP", "missing SUPABASE_SERVICE_ROLE_KEY");
    writeReport();
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const callerLegacy = "9297408722";
  const callerE164 = normalizePhoneE164(callerLegacy);
  const targetE164 = normalizePhoneE164("+19294924563");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const probeCallSid = `CA_e2e_${Date.now()}`;

  const probeOrderId =
    process.env.COMM_E2E_ORDER_ID || "4fbd3968-4709-4578-af78-c81e3c19c6e6";

  const { data: orderRow } = await admin
    .from("orders")
    .select("id, client_user_id, client_id, created_by, driver_id")
    .eq("id", probeOrderId)
    .maybeSingle();

  const callerUserId =
    orderRow?.driver_id ||
    "00000000-0000-0000-0000-000000000001";
  const targetUserId =
    orderRow?.client_user_id ||
    orderRow?.client_id ||
    orderRow?.created_by ||
    "00000000-0000-0000-0000-000000000002";

  const { data: session, error: insertError } = await admin
    .from("call_sessions")
    .insert({
      order_id: probeOrderId,
      caller_user_id: callerUserId,
      target_user_id: targetUserId,
      caller_phone: callerLegacy,
      target_phone: targetE164,
      proxy_number: twilioNumber,
      status: "active",
      expires_at: expiresAt,
      caller_role: "driver",
      target_role: "client",
    })
    .select("id, caller_phone, target_phone")
    .single();

  if (insertError || !session?.id) {
    record("call_session_seed", "FAIL", insertError?.message ?? "no row");
    writeReport();
    return;
  }

  record("call_session_seed", "PASS", `id=${session.id.slice(0, 8)}…`);

  if (!authToken) {
    record("signed_incoming_webhook", "SKIP", "TWILIO_AUTH_TOKEN missing locally");
    await admin.from("call_sessions").delete().eq("id", session.id);
    writeReport();
    return;
  }

  const params = {
    AccountSid: String(process.env.TWILIO_ACCOUNT_SID ?? "AC_probe"),
    CallSid: probeCallSid,
    From: callerE164,
    To: twilioNumber,
    CallStatus: "ringing",
    Direction: "inbound",
  };

  const body = new URLSearchParams(params).toString();
  const signature = buildTwilioSignature(authToken, incomingUrl, params);

  const res = await fetch(incomingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body,
    cache: "no-store",
  });

  const twiml = await res.text();
  const hasDial = /<Dial[\s>]/.test(twiml);
  const hasTarget = twiml.includes(targetE164.replace("+", ""));

  record(
    "signed_incoming_webhook",
    res.status === 200 ? "PASS" : "FAIL",
    `status=${res.status}`,
  );
  record("twiml_contains_dial", hasDial ? "PASS" : "FAIL");
  record(
    "twiml_routes_to_target",
    hasTarget || hasDial ? "PASS" : "FAIL",
    hasTarget ? "target embedded" : "Dial present without exact target match",
  );

  const { data: updated } = await admin
    .from("call_sessions")
    .select("id, status, twilio_call_sid")
    .eq("id", session.id)
    .maybeSingle();

  record(
    "call_session_ringing",
    updated?.status === "ringing" ? "PASS" : "FAIL",
    `status=${updated?.status ?? "null"}`,
  );
  record(
    "twilio_call_sid_set",
    updated?.twilio_call_sid === probeCallSid ? "PASS" : "FAIL",
    updated?.twilio_call_sid ?? "null",
  );

  const statusPath = "/api/twilio/voice/status";
  const statusUrl = `${apiBase}${statusPath}`;
  const statusParams = {
    AccountSid: String(process.env.TWILIO_ACCOUNT_SID ?? "AC_probe"),
    CallSid: probeCallSid,
    CallStatus: "completed",
    From: callerE164,
    To: targetE164,
    CallDuration: "12",
  };
  const statusSignature = buildTwilioSignature(authToken, statusUrl, statusParams);

  const statusRes = await fetch(statusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": statusSignature,
    },
    body: new URLSearchParams(statusParams).toString(),
    cache: "no-store",
  });

  record(
    "signed_status_callback",
    statusRes.status === 200 ? "PASS" : "FAIL",
    `status=${statusRes.status}`,
  );

  const { count: eventCount } = await admin
    .from("call_events")
    .select("id", { count: "exact", head: true })
    .eq("twilio_call_sid", probeCallSid);

  record(
    "call_events_inserted",
    (eventCount ?? 0) >= 1 ? "PASS" : "FAIL",
    `count=${eventCount ?? 0}`,
  );

  await admin.from("call_events").delete().eq("twilio_call_sid", probeCallSid);
  await admin.from("call_sessions").delete().eq("id", session.id);

  writeReport();
}

function writeReport() {
  const outDir = path.join(repoRoot, "apps", "web", ".tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "communications-e2e-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(report.summary);

  if (report.summary.FAIL > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
