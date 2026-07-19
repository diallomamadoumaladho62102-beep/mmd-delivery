/**
 * Prepare driver in 15mi radius, create Live DR checkout @ 570¢, pay if Stripe live key,
 * then audit wave-1 / offers / notification_logs / Expo ticket+receipt.
 *
 *   node --env-file=.env.local scripts/live-delivery-alert-validate.mjs
 *   PAY_LIVE=1 node --env-file=.env.local scripts/live-delivery-alert-validate.mjs
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
  title: "Live DR alert validate Baldwin→Uniondale",
  pickup_address:
    "801 Ronald Court, Baldwin, New York 11510, United States",
  dropoff_address:
    "771 New Street, Uniondale, Town of Hempstead, Nassau County, New York, 11553, United States",
  pickup_lat: 40.673897,
  pickup_lng: -73.610676,
  dropoff_lat: 40.6940815,
  dropoff_lng: -73.5905813,
};

// Place driver ~1.2 mi from Baldwin pickup (inside 15 mi).
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
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const dispatchSecret =
  process.env.DISPATCH_INTERNAL_SECRET || process.env.CRON_SECRET || "";
const payLive = String(process.env.PAY_LIVE || "").trim() === "1";

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

async function main() {
  if (!supabaseUrl || !serviceKey) abort("MISSING_SUPABASE");

  const distance = milesBetween(
    BODY.pickup_lat,
    BODY.pickup_lng,
    DRIVER_LAT,
    DRIVER_LNG,
  );
  console.log("driver_distance_miles", distance.toFixed(2));

  // 1) Prepare driver: online, approved prefs package, fresh location
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

  // 2) Auth payer + create checkout
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

  const quoteRes = await fetch(`${API}/api/delivery-requests/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(BODY),
  });
  const quoteJson = await quoteRes.json().catch(() => ({}));
  const quoteCents = Number(quoteJson?.quote?.total_cents ?? NaN);
  if (!quoteRes.ok || quoteCents !== MAX_CENTS) {
    abort("QUOTE_NOT_EXACTLY_570", { status: quoteRes.status, quoteJson });
  }

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
  if (!createRes.ok || !deliveryRequestId) {
    abort("CREATE_FAILED", { status: createRes.status, createJson });
  }

  const checkoutRes = await fetch(
    `${API}/api/stripe/client/create-delivery-request-checkout-session`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        delivery_request_id: deliveryRequestId,
        deliveryRequestId,
      }),
    },
  );
  const checkoutJson = await checkoutRes.json().catch(() => ({}));
  const sessionId = String(
    checkoutJson?.session_id ?? checkoutJson?.id ?? "",
  ).trim();
  const url = String(checkoutJson?.url ?? "").trim();
  if (!checkoutRes.ok || !sessionId) {
    abort("CHECKOUT_FAILED", { status: checkoutRes.status, checkoutJson });
  }

  let paidVia = null;
  let payDetail = null;

  if (payLive && stripeKey.startsWith("sk_live_")) {
    // Expire is not needed — pay via Checkout Session with test? Live needs real PM.
    // Prefer confirm endpoint after marking: use Stripe payment_intents confirm if PI exists.
    const piId = String(
      checkoutJson?.payment_intent_id ?? checkoutJson?.payment_intent ?? "",
    ).trim();
    if (piId.startsWith("pi_")) {
      const conf = await fetch(
        `https://api.stripe.com/v1/payment_intents/${piId}/confirm`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            payment_method: "pm_card_visa",
            return_url: "https://www.mmddelivery.com/client/delivery-requests",
          }),
        },
      );
      payDetail = await conf.json().catch(() => ({}));
      paidVia = conf.ok ? "stripe_pi_confirm" : "stripe_pi_confirm_failed";
    }
  }

  // Always try confirm-paid (idempotent if webhook already marked paid)
  await new Promise((r) => setTimeout(r, 2500));
  const confirmRes = await fetch(
    `${API}/api/stripe/client/confirm-delivery-request-paid`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        delivery_request_id: deliveryRequestId,
        session_id: sessionId,
      }),
    },
  );
  const confirmJson = await confirmRes.json().catch(() => ({}));

  // Force dispatch if still unpaid skip; if paid, call dispatch API as safety net
  let dispatchJson = null;
  if (dispatchSecret) {
    const dRes = await fetch(`${API}/api/dispatch/delivery-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dispatch-internal-secret": dispatchSecret,
      },
      body: JSON.stringify({ deliveryRequestId, wave: 1 }),
    });
    dispatchJson = await dRes.json().catch(() => ({}));
    dispatchJson._http = dRes.status;
  }

  await new Promise((r) => setTimeout(r, 2000));

  const dr = await sb(
    `/rest/v1/delivery_requests?id=eq.${deliveryRequestId}&select=id,status,payment_status,driver_id,dispatch_wave_1_started_at,paid_at,pickup_lat,pickup_lng`,
    { key: serviceKey, token: serviceKey },
  );
  const offers = await sb(
    `/rest/v1/delivery_request_driver_offers?delivery_request_id=eq.${deliveryRequestId}&select=*`,
    { key: serviceKey, token: serviceKey },
  );
  const logs = await sb(
    `/rest/v1/notification_logs?data->>delivery_request_id=eq.${deliveryRequestId}&order=created_at.desc&limit=20`,
    { key: serviceKey, token: serviceKey },
  );
  const loc = await sb(
    `/rest/v1/driver_locations?driver_id=eq.${DRIVER_ID}&select=lat,lng,updated_at`,
    { key: serviceKey, token: serviceKey },
  );

  const logRows = Array.isArray(logs.json) ? logs.json : [];
  const offerRows = Array.isArray(offers.json) ? offers.json : [];
  const drRow = Array.isArray(dr.json) ? dr.json[0] : null;

  const report = {
    audited_at: new Date().toISOString(),
    delivery_request_id: deliveryRequestId,
    checkout_session_id: sessionId,
    checkout_url: url,
    pay_live: payLive,
    paid_via: paidVia,
    pay_detail_status: payDetail?.status ?? null,
    confirm_http: confirmRes.status,
    confirm_json: confirmJson,
    dispatch_api: dispatchJson,
    driver: {
      user_id: DRIVER_ID,
      distance_miles: Number(distance.toFixed(2)),
      location: loc.json?.[0] ?? null,
    },
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
      reason: r.data?.reason ?? null,
      max_miles: r.data?.max_miles ?? null,
    })),
    verdict_hints: {
      wave1_set: Boolean(drRow?.dispatch_wave_1_started_at),
      paid: String(drRow?.payment_status ?? "").toLowerCase() === "paid",
      offers_ok: offerRows.length > 0,
      logs_ok: logRows.length > 0,
      ticket_ok: logRows.some((r) => r.data?.expo_ticket_id),
      receipt_present: logRows.some((r) => r.data?.expo_receipt != null),
    },
  };

  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../backups/live-delivery-preflight",
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "DRIVER_ALERT_VALIDATE.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
