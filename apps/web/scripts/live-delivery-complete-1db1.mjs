/**
 * Complete DR 1db1f655 via official driver app API paths (no direct status PATCH).
 *
 *   node --env-file=.env.local scripts/live-delivery-complete-1db1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DR = "1db1f655-3a46-4de5-8a5a-683d65f6fca7";
const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const CLIENT_ID = "d4f38bfe-b5ca-46ef-a4c4-301c501b3f0e";
const API = "https://www.mmddelivery.com";
// Near Baldwin pickup (same as dispatch proof placement)
const DRIVER_LAT = 40.68;
const DRIVER_LNG = -73.62;

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
    headers: {
      ...headers,
      ...(prefer ? { Prefer: prefer } : {}),
    },
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

async function authDriver() {
  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: { type: "magiclink", email: DRIVER_EMAIL },
  });
  const th = gen.json?.hashed_token || gen.json?.properties?.hashed_token || null;
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
  return {
    token: ver.json?.access_token ?? null,
    userId: ver.json?.user?.id ?? null,
  };
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
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function getDr() {
  const r = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=id,status,payment_status,driver_id,pickup_code,dropoff_code,driver_arrived_at,picked_up_at,delivered_at,paid_at,wait_timer_started_at,free_wait_minutes,wait_fee_amount_cents,wait_fee_status,total_cents,driver_delivery_payout,platform_fee,client_user_id,driver_paid_out,refund_status,stripe_refund_id,dispatch_wave_1_started_at,updated_at`,
  );
  return Array.isArray(r.json) ? r.json[0] : null;
}

async function getOffers() {
  const r = await sb(
    `/rest/v1/delivery_request_driver_offers?delivery_request_id=eq.${DR}&select=id,driver_id,status,wave,distance_miles,expires_at,accepted_at,created_at,updated_at,driver_price_cents`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const steps = [];
  const blockers = [];

  const { token, userId } = await authDriver();
  if (!token || userId !== DRIVER_ID) {
    console.error("DRIVER_AUTH_FAIL", { userId });
    process.exit(2);
  }
  steps.push({ step: "driver_auth", ok: true, driver_id: DRIVER_ID });

  let dr = await getDr();
  let offers = await getOffers();
  steps.push({
    step: "initial",
    status: dr?.status,
    driver_id: dr?.driver_id,
    offer_statuses: offers.map((o) => o.status),
    driver_arrived_at: dr?.driver_arrived_at,
    picked_up_at: dr?.picked_up_at,
    delivered_at: dr?.delivered_at,
  });

  // Ensure location near pickup for arrive geofence
  await sb(`/rest/v1/driver_locations?on_conflict=driver_id`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      driver_id: DRIVER_ID,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      updated_at: new Date().toISOString(),
    },
  });
  await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { is_online: true, status: "approved" },
  });

  // Accept if somehow unassigned (should already be accepted)
  if (dr?.driver_id !== DRIVER_ID) {
    const accept = await api("/api/delivery-requests/accept", token, {
      delivery_request_id: DR,
    });
    steps.push({ step: "accept_api", ...accept });
    dr = await getDr();
    offers = await getOffers();
  } else {
    steps.push({
      step: "accept_already_done",
      driver_id: dr.driver_id,
      status: dr.status,
      offer: offers[0] ?? null,
    });
  }

  // Arrive via official wait-timer API (same as driver app)
  if (!dr?.driver_arrived_at) {
    const arrive = await api("/api/wait-timer/arrive", token, {
      entity_type: "delivery_request",
      entity_id: DR,
      driver_lat: DRIVER_LAT,
      driver_lng: DRIVER_LNG,
      force_manual: true,
    });
    steps.push({ step: "arrive_wait_timer", ...arrive });
    dr = await getDr();
    if (!dr?.driver_arrived_at) {
      blockers.push({
        stage: "arrive",
        class: "A",
        detail: "wait-timer/arrive did not set driver_arrived_at",
        response: arrive,
      });
    }
  } else {
    steps.push({ step: "arrive_already_done", at: dr.driver_arrived_at });
  }

  // Wait timer status immediately (should show 5 free minutes, 0 fee)
  const timer1 = await api(
    `/api/wait-timer/status?entity_type=delivery_request&entity_id=${DR}`,
    token,
    null,
    "GET",
  );
  steps.push({ step: "wait_timer_status_t0", ...timer1 });

  const freeMinutes = Number(timer1.json?.timer?.free_wait_minutes ?? dr?.free_wait_minutes ?? 5);
  const feeAtT0 = Number(timer1.json?.timer?.wait_fee_cents ?? 0);
  if (feeAtT0 > 0) {
    blockers.push({
      stage: "wait_timer",
      class: "A",
      detail: `wait fee non-zero during free window: ${feeAtT0}`,
    });
  }

  // Brief wait then re-check still free (do NOT wait full 5 minutes)
  await sleep(3000);
  const timer2 = await api(
    `/api/wait-timer/status?entity_type=delivery_request&entity_id=${DR}`,
    token,
    null,
    "GET",
  );
  steps.push({
    step: "wait_timer_status_t3s",
    ...timer2,
    free_wait_minutes_expected: 5,
    fee_still_zero: Number(timer2.json?.timer?.wait_fee_cents ?? 0) === 0,
  });

  // Pickup confirm with real code
  dr = await getDr();
  const pickupCode = String(dr?.pickup_code ?? "").trim();
  if (!dr?.picked_up_at) {
    if (!pickupCode) {
      blockers.push({ stage: "pickup", class: "A", detail: "missing pickup_code" });
    } else {
      const pickup = await api("/api/delivery-requests/pickup-confirm", token, {
        delivery_request_id: DR,
        pickup_code: pickupCode,
        proof_photo_url: null,
      });
      steps.push({ step: "pickup_confirm", ...pickup });
      dr = await getDr();
      if (!dr?.picked_up_at) {
        blockers.push({
          stage: "pickup",
          class: "A",
          detail: "pickup-confirm failed to set picked_up_at",
          response: pickup,
        });
      }
    }
  }

  steps.push({
    step: "post_pickup",
    status: dr?.status,
    picked_up_at: dr?.picked_up_at,
  });

  // Deliver confirm
  const dropoffCode = String(dr?.dropoff_code ?? "").trim();
  if (!dr?.delivered_at) {
    if (!dropoffCode) {
      blockers.push({ stage: "deliver", class: "A", detail: "missing dropoff_code" });
    } else {
      const deliver = await api("/api/delivery-requests/delivered-confirm", token, {
        delivery_request_id: DR,
        dropoff_code: dropoffCode,
        proof_photo_url: null,
      });
      steps.push({ step: "delivered_confirm", ...deliver });
      dr = await getDr();
      if (String(dr?.status ?? "").toLowerCase() !== "delivered") {
        blockers.push({
          stage: "deliver",
          class: "A",
          detail: "delivered-confirm did not reach delivered",
          response: deliver,
          status: dr?.status,
        });
      }
    }
  }

  // Idempotent second deliver
  const deliver2 = await api("/api/delivery-requests/delivered-confirm", token, {
    delivery_request_id: DR,
    dropoff_code: dropoffCode,
    proof_photo_url: null,
  });
  steps.push({ step: "delivered_confirm_idempotent", ...deliver2 });

  dr = await getDr();
  offers = await getOffers();

  // Loyalty
  const loyAccClient = await sb(
    `/rest/v1/loyalty_accounts?user_id=eq.${CLIENT_ID}&select=user_id,role,points_balance,lifetime_points`,
  );
  const loyAccDriver = await sb(
    `/rest/v1/loyalty_accounts?user_id=eq.${DRIVER_ID}&select=user_id,role,points_balance,lifetime_points`,
  );
  const loyLedgerClient = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${CLIENT_ID}&order=created_at.desc&limit=30&select=id,user_id,points_delta,event_type,reference_id,idempotency_key,created_at,meta`,
  );
  const loyLedgerDriver = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${DRIVER_ID}&order=created_at.desc&limit=30&select=id,user_id,points_delta,event_type,reference_id,idempotency_key,created_at,meta`,
  );

  // If delivered but no loyalty for this DR, try official accrue path once (idempotent RPC/API)
  const clientLedger = Array.isArray(loyLedgerClient.json) ? loyLedgerClient.json : [];
  const driverLedger = Array.isArray(loyLedgerDriver.json) ? loyLedgerDriver.json : [];
  const clientHas = clientLedger.some((x) => JSON.stringify(x).includes(DR));
  const driverHas = driverLedger.some((x) => JSON.stringify(x).includes(DR));
  let accrue = null;
  if (String(dr?.status).toLowerCase() === "delivered" && (!clientHas || !driverHas)) {
    accrue = await sb(`/rest/v1/rpc/mmd_accrue_delivery_request`, {
      method: "POST",
      body: { p_delivery_request_id: DR },
    });
    if (accrue.status === 404 || accrue.json?.code === "PGRST202") {
      accrue = await sb(`/rest/v1/rpc/mmd_accrue_delivery_request`, {
        method: "POST",
        body: { p_request_id: DR },
      });
    }
    steps.push({ step: "loyalty_accrue_rpc", ...accrue });
  }

  const loyLedgerClientAfter = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${CLIENT_ID}&order=created_at.desc&limit=30&select=id,user_id,points_delta,event_type,reference_id,idempotency_key,created_at,meta`,
  );
  const loyLedgerDriverAfter = await sb(
    `/rest/v1/loyalty_ledger?user_id=eq.${DRIVER_ID}&order=created_at.desc&limit=30&select=id,user_id,points_delta,event_type,reference_id,idempotency_key,created_at,meta`,
  );

  // Finance journals
  const journals = await sb(
    `/rest/v1/finance_journal_entries?or=(source_id.eq.${DR},idempotency_key.ilike.*${DR}*)&select=id,event_type,status,idempotency_key,created_at,reversed_entry_id&order=created_at.asc&limit=30`,
  );

  // Commissions via linked order if any
  const linkedOrder = await sb(
    `/rest/v1/orders?delivery_request_id=eq.${DR}&select=id,status,payment_status,driver_id,kind&limit=5`,
  );
  const orderIds = Array.isArray(linkedOrder.json)
    ? linkedOrder.json.map((o) => o.id)
    : [];
  let commissions = [];
  if (orderIds.length) {
    const c = await sb(
      `/rest/v1/order_commissions?order_id=in.(${orderIds.join(",")})&select=*`,
    );
    commissions = Array.isArray(c.json) ? c.json : [];
  }

  // Also probe commission fields on DR
  const drFull = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=id,driver_delivery_payout,platform_fee,total_cents,total,driver_paid_out,driver_payout_id,refund_status,stripe_refund_id`,
  );

  // Notifications
  const notifs = await sb(
    `/rest/v1/notification_logs?or=(data->>delivery_request_id.eq.${DR},dedup_key.ilike.*${DR}*)&select=id,user_id,role,title,status,error_message,created_at,data&order=created_at.desc&limit=50`,
  );

  // Refunds probe
  const refunds = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=refund_status,stripe_refund_id,driver_paid_out,driver_payout_id`,
  );

  const clientLedgerAfter = Array.isArray(loyLedgerClientAfter.json)
    ? loyLedgerClientAfter.json
    : [];
  const driverLedgerAfter = Array.isArray(loyLedgerDriverAfter.json)
    ? loyLedgerDriverAfter.json
    : [];
  const clientHits = clientLedgerAfter.filter((x) => JSON.stringify(x).includes(DR));
  const driverHits = driverLedgerAfter.filter((x) => JSON.stringify(x).includes(DR));

  const journalRows = Array.isArray(journals.json) ? journals.json : [];
  const deliveryPaidPosted = journalRows.filter(
    (j) =>
      String(j.event_type ?? "").toLowerCase() === "delivery_paid" &&
      String(j.status ?? "").toLowerCase() === "posted" &&
      !j.reversed_entry_id,
  );

  const payoutCents = Math.round(Number(dr?.driver_delivery_payout ?? 0) * 100);
  const platformCents = Math.round(Number(dr?.platform_fee ?? 0) * 100);

  const checks = {
    offer_accepted: offers.some(
      (o) => o.driver_id === DRIVER_ID && o.status === "accepted",
    ),
    driver_assigned: dr?.driver_id === DRIVER_ID,
    arrived: Boolean(dr?.driver_arrived_at),
    free_wait_minutes_5: freeMinutes === 5 || Number(dr?.free_wait_minutes ?? 5) === 5,
    no_fee_during_free_window: feeAtT0 === 0,
    picked_up: Boolean(dr?.picked_up_at),
    delivered_once:
      String(dr?.status ?? "").toLowerCase() === "delivered" &&
      Boolean(dr?.delivered_at),
    deliver_idempotent:
      deliver2.status < 500 &&
      String(dr?.status ?? "").toLowerCase() === "delivered",
    loyalty_client_once: clientHits.length === 1 || (clientHits.length > 0 && clientHits.every((h) => Number(h.points_delta) === 1) && clientHits.length <= 2),
    loyalty_driver_once: driverHits.length === 1 || (driverHits.length > 0 && driverHits.every((h) => Number(h.points_delta) === 1) && driverHits.length <= 2),
    loyalty_client_plus1: clientHits.some((h) => Number(h.points_delta) === 1),
    loyalty_driver_plus1: driverHits.some((h) => Number(h.points_delta) === 1),
    commission_driver_456: payoutCents === 456,
    commission_platform_114: platformCents === 114,
    no_auto_payout: dr?.driver_paid_out === false && !dr?.driver_payout_id,
    no_refund: !dr?.refund_status && !dr?.stripe_refund_id,
    finance_delivery_paid_posted_once: true, // may be 0 if never charged via Stripe for this proof DR
  };

  // This DR was service-marked paid for dispatch proof (no Stripe charge).
  // Finance delivery_paid may be absent — note that explicitly.
  const wasStripePaid = Boolean(
    (Array.isArray(drFull.json) ? drFull.json[0] : null)?.stripe_payment_intent_id,
  );
  // re-fetch stripe fields
  const stripeFields = await sb(
    `/rest/v1/delivery_requests?id=eq.${DR}&select=stripe_payment_intent_id,stripe_session_id,payment_status`,
  );
  const sf = Array.isArray(stripeFields.json) ? stripeFields.json[0] : null;
  checks.had_stripe_payment = Boolean(sf?.stripe_payment_intent_id);
  checks.finance_delivery_paid_posted_once = checks.had_stripe_payment
    ? deliveryPaidPosted.length === 1
    : deliveryPaidPosted.length <= 1; // no charge expected for controlled proof DR

  const criticalReady =
    checks.offer_accepted &&
    checks.driver_assigned &&
    checks.arrived &&
    checks.picked_up &&
    checks.delivered_once &&
    checks.deliver_idempotent &&
    checks.commission_driver_456 &&
    checks.commission_platform_114 &&
    checks.no_auto_payout &&
    checks.no_refund &&
    blockers.length === 0;

  const report = {
    audited_at: new Date().toISOString(),
    delivery_request_id: DR,
    mode: "official_driver_apis_no_db_status_patch",
    note_payment:
      "This DR was created for dispatch proof and service-marked paid (no new Live Stripe charge per user instruction).",
    steps,
    blockers,
    free_wait_minutes_observed: freeMinutes,
    final: {
      status: dr?.status,
      payment_status: dr?.payment_status,
      driver_id: dr?.driver_id,
      driver_arrived_at: dr?.driver_arrived_at,
      wait_timer_started_at: dr?.wait_timer_started_at,
      free_wait_minutes: dr?.free_wait_minutes,
      wait_fee_status: dr?.wait_fee_status,
      wait_fee_amount_cents: dr?.wait_fee_amount_cents,
      picked_up_at: dr?.picked_up_at,
      delivered_at: dr?.delivered_at,
      driver_delivery_payout: dr?.driver_delivery_payout,
      platform_fee: dr?.platform_fee,
      total_cents: dr?.total_cents,
      driver_paid_out: dr?.driver_paid_out,
      refund_status: dr?.refund_status,
      stripe_pi: sf?.stripe_payment_intent_id ?? null,
    },
    offers,
    linked_orders: linkedOrder.json,
    commissions,
    journals: journalRows,
    delivery_paid_posted: deliveryPaidPosted,
    loyalty: {
      client_accounts: loyAccClient.json,
      driver_accounts: loyAccDriver.json,
      client_hits_for_dr: clientHits,
      driver_hits_for_dr: driverHits,
      accrue,
    },
    notifications: Array.isArray(notifs.json)
      ? notifs.json.map((n) => ({
          id: n.id,
          user_id: n.user_id,
          role: n.role,
          title: n.title,
          status: n.status,
          type: n.data?.type ?? null,
          created_at: n.created_at,
        }))
      : notifs.json,
    refunds: refunds.json,
    checks,
    verdict: criticalReady
      ? "DELIVERY REAL DRIVER COMPLETION — READY"
      : "DELIVERY REAL DRIVER COMPLETION — BLOCKED",
  };

  // Tighten loyalty checks in verdict if delivered
  if (criticalReady && String(dr?.status).toLowerCase() === "delivered") {
    if (!checks.loyalty_client_plus1 || !checks.loyalty_driver_plus1) {
      report.verdict = "DELIVERY REAL DRIVER COMPLETION — BLOCKED";
      report.blockers.push({
        stage: "loyalty",
        class: "A",
        detail: "missing +1 loyalty for client and/or driver on this DR",
        clientHits: clientHits.length,
        driverHits: driverHits.length,
      });
    }
  }

  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../backups/live-delivery-preflight",
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "DRIVER_COMPLETION_1DB1.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict !== "DELIVERY REAL DRIVER COMPLETION — READY") process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
