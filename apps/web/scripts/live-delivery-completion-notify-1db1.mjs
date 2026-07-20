/**
 * Controlled completion-notification proof for already-delivered DR 1db1.
 * No new payment / refund / payout. Uses official delivered-confirm only.
 *
 *   node --env-file=.env.local scripts/live-delivery-completion-notify-1db1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DR = "1db1f655-3a46-4de5-8a5a-683d65f6fca7";
const DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const CLIENT_ID = "d4f38bfe-b5ca-46ef-a4c4-301c501b3f0e";
const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const API = process.env.MMD_API_BASE || "https://www.mmddelivery.com";
const DROPOFF_CODE = "109607";

const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function sb(pathAndQuery, { method = "GET", headers = adminHeaders, body, prefer } = {}) {
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

async function api(pathname, token, body) {
  const r = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

function summarizeLogs(rows) {
  return (rows ?? []).map((r) => ({
    id: r.id,
    role: r.role,
    title: r.title,
    status: r.status,
    dedup_key: r.dedup_key,
    created_at: r.created_at,
    expo_ticket_id: r.data?.expo_ticket_id ?? null,
    expo_ticket_status: r.data?.expo_ticket_status ?? null,
    expo_receipt_status: r.data?.expo_receipt_status ?? null,
    event_type: r.data?.event_type ?? null,
  }));
}

async function loadCompletionLogs() {
  const r = await sb(
    `/rest/v1/notification_logs?or=(dedup_key.eq.delivery_request_delivered_client:${DR},dedup_key.eq.delivery_request_delivered_driver:${DR})&select=id,user_id,role,title,status,dedup_key,error_message,created_at,data&order=created_at.asc`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

async function loadFinanceSnapshot() {
  const dr = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=id,status,payment_status,driver_id,total_cents,driver_delivery_payout,platform_fee,driver_paid_out,driver_payout_id,refund_status,stripe_refund_id,stripe_payment_intent_id`,
  );
  const loyalty = await sb(
    `/rest/v1/loyalty_ledger?idempotency_key=like.delivery:${DR}:*&select=idempotency_key,delta_points,user_id,created_at`,
  );
  return {
    dr: Array.isArray(dr.json) ? dr.json[0] : null,
    loyalty: Array.isArray(loyalty.json) ? loyalty.json : [],
  };
}

async function main() {
  const blockers = [];
  const steps = [];

  if (!supabaseUrl || !serviceKey || !anon) {
    throw new Error("Missing Supabase env");
  }

  const beforeFinance = await loadFinanceSnapshot();
  const beforeLogs = await loadCompletionLogs();
  steps.push({
    step: "baseline",
    completion_logs_before: beforeLogs.length,
    status: beforeFinance.dr?.status,
  });

  if (String(beforeFinance.dr?.status ?? "").toLowerCase() !== "delivered") {
    blockers.push(`DR not delivered (status=${beforeFinance.dr?.status})`);
  }

  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: {
      type: "magiclink",
      email: DRIVER_EMAIL,
    },
  });
  const hashed = gen.json?.hashed_token;
  if (!hashed) {
    blockers.push("Could not generate driver magic link");
  }

  let driverToken = "";
  if (hashed) {
    const verify = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        token_hash: hashed,
      }),
    });
    const vj = await verify.json().catch(() => ({}));
    driverToken = vj.access_token || "";
    if (!driverToken) blockers.push("Driver token missing");
  }

  if (blockers.length) {
    const out = { verdict: "DELIVERY COMPLETION NOTIFICATIONS — BLOCKED", blockers, steps };
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const call1 = await api("/api/delivery-requests/delivered-confirm", driverToken, {
    delivery_request_id: DR,
    dropoff_code: DROPOFF_CODE,
  });
  steps.push({ step: "delivered_confirm_1", http: call1.status, body: call1.json });

  // Allow receipt wait + log insert
  await new Promise((r) => setTimeout(r, 2500));
  const after1 = await loadCompletionLogs();
  steps.push({
    step: "logs_after_call_1",
    count: after1.length,
    logs: summarizeLogs(after1),
  });

  const call2 = await api("/api/delivery-requests/delivered-confirm", driverToken, {
    delivery_request_id: DR,
    dropoff_code: DROPOFF_CODE,
  });
  steps.push({ step: "delivered_confirm_2", http: call2.status, body: call2.json });

  await new Promise((r) => setTimeout(r, 1500));
  const after2 = await loadCompletionLogs();
  steps.push({
    step: "logs_after_call_2",
    count: after2.length,
    logs: summarizeLogs(after2),
  });

  const afterFinance = await loadFinanceSnapshot();

  const clientLogs = after2.filter(
    (r) =>
      r.dedup_key === `delivery_request_delivered_client:${DR}` &&
      r.status === "sent",
  );
  const driverLogs = after2.filter(
    (r) =>
      r.dedup_key === `delivery_request_delivered_driver:${DR}` &&
      r.status === "sent",
  );

  const clientHasTicket = clientLogs.some((r) => r.data?.expo_ticket_id);
  const driverHasTicket = driverLogs.some((r) => r.data?.expo_ticket_id);
  const clientHasReceipt = clientLogs.some(
    (r) => r.data?.expo_receipt_status != null || r.data?.expo_receipt != null,
  );
  const driverHasReceipt = driverLogs.some(
    (r) => r.data?.expo_receipt_status != null || r.data?.expo_receipt != null,
  );

  const noDoublePush =
    after2.filter((r) => r.status === "sent").length ===
      clientLogs.length + driverLogs.length &&
    call2.json?.completion_notifications?.client?.skipped === "dedup" &&
    call2.json?.completion_notifications?.driver?.skipped === "dedup";

  const financeUnchanged =
    JSON.stringify({
      payout: beforeFinance.dr?.driver_paid_out,
      refund: beforeFinance.dr?.refund_status,
      pi: beforeFinance.dr?.stripe_payment_intent_id,
      driver_fee: beforeFinance.dr?.driver_delivery_payout,
      platform: beforeFinance.dr?.platform_fee,
      loyalty: beforeFinance.loyalty.map((x) => x.idempotency_key).sort(),
    }) ===
    JSON.stringify({
      payout: afterFinance.dr?.driver_paid_out,
      refund: afterFinance.dr?.refund_status,
      pi: afterFinance.dr?.stripe_payment_intent_id,
      driver_fee: afterFinance.dr?.driver_delivery_payout,
      platform: afterFinance.dr?.platform_fee,
      loyalty: afterFinance.loyalty.map((x) => x.idempotency_key).sort(),
    });

  if (!(call1.status === 200 && call1.json?.ok === true)) {
    blockers.push(`call1 failed http=${call1.status}`);
  }
  if (!(call2.status === 200 && call2.json?.ok === true)) {
    blockers.push(`call2 failed http=${call2.status}`);
  }
  if (clientLogs.length < 1) blockers.push("missing client sent completion log");
  if (driverLogs.length < 1) blockers.push("missing driver sent completion log");
  if (!clientHasTicket) blockers.push("client missing expo ticket");
  if (!driverHasTicket) blockers.push("driver missing expo ticket");
  if (!clientHasReceipt) blockers.push("client missing expo receipt field");
  if (!driverHasReceipt) blockers.push("driver missing expo receipt field");
  if (!noDoublePush) blockers.push("dedup/no-double-push check failed");
  if (!financeUnchanged) blockers.push("finance/loyalty/commissions changed");

  // Token presence soft-check (failed no_tokens would have blocked sent above)
  const tokens = await sb(
    `/rest/v1/user_push_tokens?or=(user_id.eq.${CLIENT_ID},user_id.eq.${DRIVER_ID})&select=user_id,role,expo_push_token,platform`,
  );

  const verdict =
    blockers.length === 0
      ? "DELIVERY COMPLETION NOTIFICATIONS — READY"
      : "DELIVERY COMPLETION NOTIFICATIONS — BLOCKED";

  const fullFlow =
    verdict === "DELIVERY COMPLETION NOTIFICATIONS — READY"
      ? "DELIVERY FULL FLOW — READY"
      : "DELIVERY FULL FLOW — BLOCKED";

  const report = {
    audited_at: new Date().toISOString(),
    delivery_request_id: DR,
    api_base: API,
    verdict,
    full_flow_verdict: fullFlow,
    blockers,
    proofs: {
      already_delivered_calls: {
        call1_http: call1.status,
        call1_already_delivered: !!call1.json?.already_delivered,
        call2_http: call2.status,
        call2_client_skipped: call2.json?.completion_notifications?.client?.skipped,
        call2_driver_skipped: call2.json?.completion_notifications?.driver?.skipped,
      },
      notification_logs: summarizeLogs(after2),
      client_sent: clientLogs.length,
      driver_sent: driverLogs.length,
      expo_tickets: { client: clientHasTicket, driver: driverHasTicket },
      expo_receipts: { client: clientHasReceipt, driver: driverHasReceipt },
      no_double_push: noDoublePush,
      finance_loyalty_commissions_unchanged: financeUnchanged,
      push_tokens_present: Array.isArray(tokens.json) ? tokens.json.length : 0,
    },
    steps,
    taxi: "not_started",
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(__dirname, "../../../backups/live-delivery-preflight");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "COMPLETION_NOTIFY_1DB1_VERDICT.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (blockers.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
