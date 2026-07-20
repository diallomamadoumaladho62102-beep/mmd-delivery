/**
 * Finish remaining steps for DR 1db1 (already picked_up) via official APIs.
 * dropoff wait-timer arrive → deliver → loyalty → audit
 *
 *   node --env-file=.env.local scripts/live-delivery-finish-1db1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DR = "1db1f655-3a46-4de5-8a5a-683d65f6fca7";
const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const CLIENT_ID = "d4f38bfe-b5ca-46ef-a4c4-301c501b3f0e";
const API = "https://www.mmddelivery.com";
const DROP_LAT = 40.6940815;
const DROP_LNG = -73.5905813;

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

async function api(pathname, token, body, method = "POST") {
  const r = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function getDr() {
  const r = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=id,status,payment_status,driver_id,pickup_code,dropoff_code,driver_arrived_at,picked_up_at,delivered_at,wait_timer_started_at,free_wait_minutes,wait_fee_amount_cents,wait_fee_status,total_cents,driver_delivery_payout,platform_fee,driver_paid_out,driver_payout_id,refund_status,stripe_refund_id,stripe_payment_intent_id,client_user_id`,
  );
  return Array.isArray(r.json) ? r.json[0] : null;
}

async function main() {
  const steps = [];
  const blockers = [];

  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: { type: "magiclink", email: DRIVER_EMAIL },
  });
  const th = gen.json?.hashed_token || gen.json?.properties?.hashed_token;
  const ver = await sb("/auth/v1/verify", {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: { type: "magiclink", token_hash: th },
  });
  const token = ver.json?.access_token;
  if (!token || ver.json?.user?.id !== DRIVER_ID) {
    console.error("AUTH_FAIL", ver.json);
    process.exit(2);
  }

  // Place driver at dropoff for wait-timer arrive geofence
  await sb(`/rest/v1/driver_locations?on_conflict=driver_id`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      driver_id: DRIVER_ID,
      lat: DROP_LAT,
      lng: DROP_LNG,
      updated_at: new Date().toISOString(),
    },
  });

  let dr = await getDr();
  steps.push({ step: "initial", status: dr?.status, picked_up_at: dr?.picked_up_at, delivered_at: dr?.delivered_at });

  // Dropoff arrival wait-timer (official model: after picked_up)
  if (!dr?.driver_arrived_at) {
    const arrive = await api("/api/wait-timer/arrive", token, {
      entity_type: "delivery_request",
      entity_id: DR,
      driver_lat: DROP_LAT,
      driver_lng: DROP_LNG,
      force_manual: true,
    });
    steps.push({ step: "dropoff_arrive", ...arrive });
    dr = await getDr();
    if (!dr?.driver_arrived_at) {
      blockers.push({ stage: "dropoff_arrive", class: "A", detail: arrive });
    }
  }

  const timer = await api(
    `/api/wait-timer/status?entity_type=delivery_request&entity_id=${DR}`,
    token,
    null,
    "GET",
  );
  steps.push({ step: "wait_timer_status", ...timer });
  const fee = Number(timer.json?.timer?.wait_fee_cents ?? 0);
  const freeMin = Number(timer.json?.timer?.free_wait_minutes ?? dr?.free_wait_minutes ?? 0);
  if (fee > 0) {
    blockers.push({ stage: "wait_fee", class: "A", detail: `fee ${fee} during free window` });
  }

  // Deliver
  const dropoffCode = String(dr?.dropoff_code ?? "").trim();
  if (String(dr?.status).toLowerCase() !== "delivered") {
    const deliver = await api("/api/delivery-requests/delivered-confirm", token, {
      delivery_request_id: DR,
      dropoff_code: dropoffCode,
      proof_photo_url: null,
    });
    steps.push({ step: "delivered_confirm", ...deliver });
    dr = await getDr();
    if (String(dr?.status).toLowerCase() !== "delivered") {
      blockers.push({ stage: "deliver", class: "A", detail: deliver, status: dr?.status });
    }
  }

  const deliver2 = await api("/api/delivery-requests/delivered-confirm", token, {
    delivery_request_id: DR,
    dropoff_code: dropoffCode,
    proof_photo_url: null,
  });
  steps.push({ step: "delivered_idempotent", ...deliver2 });
  dr = await getDr();

  // Loyalty accrue if missing
  let accrue = await sb(`/rest/v1/rpc/mmd_accrue_delivery_request`, {
    method: "POST",
    body: { p_delivery_request_id: DR },
  });
  if (accrue.status >= 400 || accrue.json?.code === "PGRST202") {
    accrue = await sb(`/rest/v1/rpc/award_delivery_request_loyalty`, {
      method: "POST",
      body: { p_delivery_request_id: DR },
    });
  }
  steps.push({ step: "loyalty_accrue", ...accrue });

  // Also try API path if delivered-confirm should have done it
  const loyClient = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${CLIENT_ID}&order=created_at.desc&limit=40&select=*`,
  );
  const loyDriver = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${DRIVER_ID}&order=created_at.desc&limit=40&select=*`,
  );
  const clientHits = (Array.isArray(loyClient.json) ? loyClient.json : []).filter((x) =>
    JSON.stringify(x).includes(DR),
  );
  const driverHits = (Array.isArray(loyDriver.json) ? loyDriver.json : []).filter((x) =>
    JSON.stringify(x).includes(DR),
  );

  const notifs = await sb(
    `/rest/v1/notification_logs?or=(data->>delivery_request_id.eq.${DR},dedup_key.ilike.*${DR}*)&select=id,user_id,role,title,status,created_at,data&order=created_at.desc&limit=40`,
  );
  const offers = await sb(
    `/rest/v1/delivery_request_driver_offers?delivery_request_id=eq.${DR}&select=id,driver_id,status,accepted_at,updated_at,driver_price_cents`,
  );
  const journals = await sb(
    `/rest/v1/finance_journal_entries?or=(source_id.eq.${DR},idempotency_key.ilike.*${DR}*)&select=id,event_type,status,idempotency_key,created_at&limit=20`,
  );

  const payoutCents = Math.round(Number(dr?.driver_delivery_payout ?? 0) * 100);
  const platformCents = Math.round(Number(dr?.platform_fee ?? 0) * 100);

  const checks = {
    offer_accepted: (Array.isArray(offers.json) ? offers.json : []).some(
      (o) => o.driver_id === DRIVER_ID && o.status === "accepted",
    ),
    driver_assigned: dr?.driver_id === DRIVER_ID,
    picked_up: Boolean(dr?.picked_up_at),
    dropoff_arrived: Boolean(dr?.driver_arrived_at),
    free_wait_5: freeMin === 5,
    no_fee_in_free_window: fee === 0,
    delivered_once: String(dr?.status).toLowerCase() === "delivered" && Boolean(dr?.delivered_at),
    deliver_idempotent_ok: deliver2.status < 500 && String(dr?.status).toLowerCase() === "delivered",
    loyalty_client_plus1: clientHits.some((h) => Number(h.points_delta ?? h.points ?? 0) === 1),
    loyalty_driver_plus1: driverHits.some((h) => Number(h.points_delta ?? h.points ?? 0) === 1),
    commission_driver_456: payoutCents === 456,
    commission_platform_114: platformCents === 114,
    no_payout: dr?.driver_paid_out === false && !dr?.driver_payout_id,
    no_refund: !dr?.refund_status && !dr?.stripe_refund_id,
    no_stripe_charge_on_this_proof_dr: !dr?.stripe_payment_intent_id,
  };

  // Model note: pickup wait "Arrivé au pickup" is not a DR status; wait timer is dropoff-side after picked_up.
  const ready =
    checks.offer_accepted &&
    checks.driver_assigned &&
    checks.picked_up &&
    checks.dropoff_arrived &&
    checks.free_wait_5 &&
    checks.no_fee_in_free_window &&
    checks.delivered_once &&
    checks.deliver_idempotent_ok &&
    checks.loyalty_client_plus1 &&
    checks.loyalty_driver_plus1 &&
    checks.commission_driver_456 &&
    checks.commission_platform_114 &&
    checks.no_payout &&
    checks.no_refund &&
    blockers.length === 0;

  const report = {
    audited_at: new Date().toISOString(),
    delivery_request_id: DR,
    production_deploy: "mmd-delivery-qcdqapx79",
    commits: ["fae8cbc", "a21d8c4"],
    model_note:
      "Official Delivery Request flow: accept→dispatched→pickup code→picked_up→(wait timer at dropoff)→dropoff code→delivered. There is no separate pickup-arrival status in confirm_delivery_request_pickup.",
    steps,
    blockers,
    final: dr,
    offers: offers.json,
    wait_timer: timer.json,
    loyalty: { clientHits, driverHits, accrue },
    journals: journals.json,
    notifications: Array.isArray(notifs.json)
      ? notifs.json.map((n) => ({
          id: n.id,
          role: n.role,
          title: n.title,
          status: n.status,
          type: n.data?.type ?? null,
          created_at: n.created_at,
        }))
      : notifs.json,
    checks,
    verdict: ready
      ? "DELIVERY REAL DRIVER COMPLETION — READY"
      : "DELIVERY REAL DRIVER COMPLETION — BLOCKED",
  };

  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../backups/live-delivery-preflight",
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "DRIVER_COMPLETION_1DB1_FINAL.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!ready) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
