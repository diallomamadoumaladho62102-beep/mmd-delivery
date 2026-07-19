/**
 * Controlled Live Delivery dispatch proof (no Stripe charge) against production.
 * Places test driver inside 15mi, marks DR paid, clears any race assignment,
 * then calls POST /api/dispatch/delivery-request and audits Expo tickets/receipts.
 *
 *   node --env-file=.env.local scripts/live-delivery-dispatch-proof.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CENTS = 570;
const PAYER = "mmddelivery621@gmail.com";
const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const API = "https://www.mmddelivery.com";
const BODY = {
  request_type: "package",
  title: "Live DR dispatch proof 15mi",
  pickup_address:
    "801 Ronald Court, Baldwin, New York 11510, United States",
  dropoff_address:
    "771 New Street, Uniondale, Town of Hempstead, Nassau County, New York, 11553, United States",
  pickup_lat: 40.673897,
  pickup_lng: -73.610676,
  dropoff_lat: 40.6940815,
  dropoff_lng: -73.5905813,
};
const DRIVER_LAT = 40.68;
const DRIVER_LNG = -73.62;

const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";
const dispatchSecret =
  process.env.DISPATCH_INTERNAL_SECRET || process.env.CRON_SECRET || "";

function abort(msg, extra) {
  console.error("ABORT", msg, extra ? JSON.stringify(extra, null, 2) : "");
  process.exit(2);
}

async function sb(pathAndQuery, { method = "GET", token, body, key, prefer } = {}) {
  const k = key || anonKey;
  const res = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: {
      apikey: k,
      Authorization: `Bearer ${token || k}`,
      Accept: "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function resetForDispatch(deliveryRequestId) {
  const nowIso = new Date().toISOString();
  await sb(
    `/rest/v1/delivery_request_driver_offers?delivery_request_id=eq.${deliveryRequestId}`,
    {
      method: "DELETE",
      key: serviceKey,
      token: serviceKey,
    },
  );
  const mark = await sb(
    `/rest/v1/delivery_requests?id=eq.${deliveryRequestId}`,
    {
      method: "PATCH",
      key: serviceKey,
      token: serviceKey,
      prefer: "return=representation",
      body: {
        payment_status: "paid",
        paid_at: nowIso,
        status: "pending",
        driver_id: null,
        dispatch_wave_1_started_at: null,
        updated_at: nowIso,
      },
    },
  );
  if (!mark.res.ok) abort("RESET_FAILED", mark.json);
}

async function callDispatch(deliveryRequestId) {
  const dRes = await fetch(`${API}/api/dispatch/delivery-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-dispatch-internal-secret": dispatchSecret,
    },
    body: JSON.stringify({ deliveryRequestId, wave: 1 }),
  });
  const dispatchJson = await dRes.json().catch(() => ({}));
  return { http: dRes.status, json: dispatchJson };
}

async function main() {
  if (!supabaseUrl || !serviceKey) abort("MISSING_SUPABASE");
  if (!dispatchSecret) abort("MISSING_DISPATCH_SECRET");

  const distance = milesBetween(
    BODY.pickup_lat,
    BODY.pickup_lng,
    DRIVER_LAT,
    DRIVER_LNG,
  );

  await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
    method: "PATCH",
    key: serviceKey,
    token: serviceKey,
    prefer: "return=minimal",
    body: { is_online: true, status: "approved" },
  });

  await sb(`/rest/v1/driver_service_preferences?on_conflict=driver_user_id`, {
    method: "POST",
    key: serviceKey,
    token: serviceKey,
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      driver_user_id: DRIVER_ID,
      food_delivery_enabled: true,
      package_delivery_enabled: true,
      taxi_rides_enabled: true,
    },
  });

  await sb(`/rest/v1/driver_locations?on_conflict=driver_id`, {
    method: "POST",
    key: serviceKey,
    token: serviceKey,
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      driver_id: DRIVER_ID,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      updated_at: new Date().toISOString(),
    },
  });

  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    key: serviceKey,
    token: serviceKey,
    body: { type: "magiclink", email: PAYER },
  });
  const th = gen.json?.hashed_token || gen.json?.properties?.hashed_token;
  const ver = await sb("/auth/v1/verify", {
    method: "POST",
    body: { type: "magiclink", token_hash: th },
  });
  if (!ver.json?.access_token) abort("AUTH_FAIL", ver.json);
  const token = ver.json.access_token;

  const createRes = await fetch(`${API}/api/delivery-requests/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(BODY),
  });
  const createJson = await createRes.json().catch(() => ({}));
  const deliveryRequestId = String(
    createJson?.delivery_request_id ?? "",
  ).trim();
  const createCents = Number(createJson?.pricing?.total_cents ?? NaN);
  if (!createRes.ok || !deliveryRequestId || createCents !== MAX_CENTS) {
    abort("CREATE_FAILED", { status: createRes.status, createJson });
  }

  let dispatch = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await resetForDispatch(deliveryRequestId);
    dispatch = await callDispatch(deliveryRequestId);
    if (
      dispatch.json?.ok &&
      Number(dispatch.json?.candidates ?? 0) > 0 &&
      Number(dispatch.json?.notified ?? 0) >= 0 &&
      String(dispatch.json?.message ?? "") !== "Delivery request is not dispatchable"
    ) {
      break;
    }
    // Race: driver app accepted between reset and dispatch.
    if (String(dispatch.json?.message ?? "").includes("not dispatchable")) {
      continue;
    }
    break;
  }

  await new Promise((r) => setTimeout(r, 2500));

  const dr = await sb(
    `/rest/v1/delivery_requests?id=eq.${deliveryRequestId}&select=id,status,payment_status,driver_id,dispatch_wave_1_started_at,paid_at`,
    { key: serviceKey, token: serviceKey },
  );
  const offers = await sb(
    `/rest/v1/delivery_request_driver_offers?delivery_request_id=eq.${deliveryRequestId}&select=id,driver_id,status,wave,distance_miles,expires_at,created_at`,
    { key: serviceKey, token: serviceKey },
  );
  const logs = await sb(
    `/rest/v1/notification_logs?or=(data->>delivery_request_id.eq.${deliveryRequestId},dedup_key.ilike.*${deliveryRequestId}*)&order=created_at.desc&limit=30`,
    { key: serviceKey, token: serviceKey },
  );

  const drRow = Array.isArray(dr.json) ? dr.json[0] : null;
  const offerRows = Array.isArray(offers.json) ? offers.json : [];
  const logRows = Array.isArray(logs.json) ? logs.json : [];
  const tickets = logRows.map((r) => r.data?.expo_ticket_id).filter(Boolean);
  const receipts = logRows.filter((r) => r.data?.expo_receipt != null);

  const report = {
    audited_at: new Date().toISOString(),
    mode: "controlled_dispatch_proof_no_stripe_charge",
    production_deploy: "mmd-delivery-dmatqdx73",
    delivery_request_id: deliveryRequestId,
    amount_cents: MAX_CENTS,
    driver: {
      user_id: DRIVER_ID,
      distance_miles: Number(distance.toFixed(2)),
      max_dispatch_miles_expected: 15,
      in_radius: distance <= 15,
    },
    dispatch_http: dispatch?.http ?? null,
    dispatch_response: dispatch?.json ?? null,
    delivery_request: drRow,
    offers_count: offerRows.length,
    offers: offerRows,
    notification_logs_count: logRows.length,
    notification_logs: logRows.map((r) => ({
      id: r.id,
      status: r.status,
      error_message: r.error_message,
      sent_at: r.sent_at,
      created_at: r.created_at,
      provider: r.data?.provider ?? null,
      expo_ticket_id: r.data?.expo_ticket_id ?? null,
      expo_ticket_status: r.data?.expo_ticket_status ?? null,
      expo_receipt_status: r.data?.expo_receipt_status ?? null,
      expo_token_masked: r.data?.expo_token_masked ?? null,
      reason: r.data?.reason ?? null,
      max_miles: r.data?.max_miles ?? null,
      distance_miles: r.data?.distance_miles ?? null,
    })),
    checks: {
      wave1_set: Boolean(drRow?.dispatch_wave_1_started_at),
      paid: String(drRow?.payment_status ?? "").toLowerCase() === "paid",
      offers_ok: offerRows.some((o) => o.driver_id === DRIVER_ID),
      logs_ok: logRows.some((r) => r.data?.type === "delivery_request_dispatch"),
      ticket_ok: tickets.length > 0,
      receipt_recorded: receipts.length > 0,
      notified_gt_0: Number(dispatch?.json?.notified ?? 0) > 0,
      max_miles_15: Number(dispatch?.json?.maxMiles ?? 0) === 15,
      candidates_gt_0: Number(dispatch?.json?.candidates ?? 0) > 0,
    },
  };

  report.verdict = {
    DELIVERY_BACKEND:
      report.checks.paid && report.checks.wave1_set ? "READY" : "BLOCKED",
    DRIVER_DELIVERY_ALERT:
      report.checks.wave1_set &&
      report.checks.offers_ok &&
      report.checks.logs_ok &&
      report.checks.ticket_ok &&
      report.checks.notified_gt_0 &&
      report.checks.max_miles_15 &&
      report.checks.candidates_gt_0
        ? "READY"
        : "BLOCKED",
  };

  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../backups/live-delivery-preflight",
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "DRIVER_DISPATCH_PROOF.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (report.verdict.DRIVER_DELIVERY_ALERT !== "READY") process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
