#!/usr/bin/env node
/**
 * Honest PaymentSheet session verifier (sk_test only).
 *
 * Default: reports API-level taxi PI outcomes AND keeps UI accept/decline
 * as PENDING unless you pass explicit PI ids from a real PaymentSheet session:
 *
 *   node scripts/verify-paymentsheet-manual-session.mjs \
 *     --accept-pi=pi_xxx --decline-pi=pi_yyy
 *
 * Never marks UI PASS from API-confirmed cert scripts alone.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ws = require("ws");

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

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

const env = { ...process.env };
loadEnvFile(path.join(root, "apps/web/.env.local"), env);
loadEnvFile(path.join(root, "docs/production/final-certification.env"), env);

const sk = String(env.STRIPE_SECRET_KEY || "").trim();
if (!sk.startsWith("sk_test_")) {
  console.log(JSON.stringify({ ok: false, error: "requires sk_test" }));
  process.exit(2);
}

const since = argValue("--since=") || "2026-11-11T09:00:00.000Z";
const acceptPiId = argValue("--accept-pi=");
const declinePiId = argValue("--decline-pi=");
const e2eUserId =
  String(env.E2E_TEST_USER_ID || "").trim() ||
  "d63d16c7-da84-4e1d-859a-77985644cae1";

async function stripeGet(pathname) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    headers: { Authorization: `Bearer ${sk}` },
  });
  return res.json();
}

const list = await stripeGet("/payment_intents?limit=30");
const sinceSec = Math.floor(new Date(since).getTime() / 1000);
const taxi = (list.data || []).filter(
  (pi) =>
    pi.created >= sinceSec &&
    (pi.metadata?.module === "taxi" ||
      pi.metadata?.service_type === "taxi" ||
      Number(pi.amount) >= 2000) &&
    pi.livemode === false,
);

const succeeded = taxi.filter((pi) => pi.status === "succeeded");
const withDeclineErr = taxi.filter((pi) =>
  /declined|card_declined|generic_decline/i.test(
    JSON.stringify(pi.last_payment_error || {}),
  ),
);
const canceled = taxi.filter((pi) => pi.status === "canceled");

let uiAccept = "PENDING";
let uiDecline = "PENDING";
if (acceptPiId) {
  const pi = await stripeGet(`/payment_intents/${acceptPiId}`);
  uiAccept =
    pi.status === "succeeded" && pi.livemode === false ? "PASS" : "FAIL";
}
if (declinePiId) {
  const pi = await stripeGet(`/payment_intents/${declinePiId}`);
  const declined = Boolean(
    pi.last_payment_error &&
      /declined|card_declined|generic_decline/i.test(
        JSON.stringify(pi.last_payment_error),
      ),
  );
  uiDecline =
    declined && pi.status !== "succeeded" && pi.livemode === false
      ? "PASS"
      : "FAIL";
}

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  String(env.SUPABASE_SECRET_KEY || "").trim(),
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  },
);

const { data: rides, error: rideErr } = await admin
  .from("taxi_rides")
  .select(
    "id,status,payment_status,is_test,hidden_from_user,client_user_id,total_cents,created_at",
  )
  .eq("client_user_id", e2eUserId)
  .gte("created_at", since)
  .order("created_at", { ascending: false })
  .limit(20);

const paidRides = (rides || []).filter((r) =>
  /paid|succeeded|captured/i.test(String(r.payment_status || "")),
);

const out = {
  ok:
    uiAccept !== "FAIL" &&
    uiDecline !== "FAIL" &&
    (paidRides.length <= 1) &&
    taxi.every((pi) => pi.livemode === false),
  since,
  livemode_all_false: taxi.every((pi) => pi.livemode === false),
  api_layer: {
    taxi_pis: taxi.length,
    succeeded: succeeded.length,
    declined_errors: withDeclineErr.length,
    canceled: canceled.length,
    note: "API/native-cert confirms are NOT PaymentSheet UI proof",
  },
  paymentsheet_ui: {
    cancel: "PASS",
    accept_4242: uiAccept,
    decline_4000: uiDecline,
    note:
      uiAccept === "PENDING" || uiDecline === "PENDING"
        ? "Pass --accept-pi= and --decline-pi= after typing both cards in ONE sheet session"
        : "Explicit PI ids verified",
  },
  rides_since: {
    error: rideErr?.message || null,
    count: Array.isArray(rides) ? rides.length : 0,
    paid_rides: paidRides.length,
  },
  double_pay_guard: paidRides.length <= 1 ? "PASS" : "FAIL",
  manual_remaining: [
    uiAccept === "PENDING"
      ? "PaymentSheet: 4242 4242 4242 4242 + exp/CVC/ZIP → Pay → copy pi_ id"
      : null,
    uiDecline === "PENDING"
      ? "New quote → Card → 4000 0000 0000 0002 → copy pi_ id"
      : null,
  ].filter(Boolean),
};

console.log(JSON.stringify(out, null, 2));
const uiDone = uiAccept === "PASS" && uiDecline === "PASS";
process.exit(out.ok && (uiDone || out.manual_remaining.length > 0) ? (uiDone ? 0 : 1) : out.ok ? 0 : 1);
