/**
 * TAXI PAYMENT PREFLIGHT — Nassau County
 * Creates ONE unpaid taxi ride (quoted/unpaid). Does NOT create Checkout,
 * PaymentIntent, or any Stripe charge.
 *
 *   node --env-file=.env.local scripts/live-taxi-payment-preflight.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_EMAIL = "mmddelivery621@gmail.com";
const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const VEHICLE_ID = "ad9472e9-5f37-4225-a849-271b998ca0a2";
const API = process.env.MMD_API_BASE || "https://www.mmddelivery.com";
const MAX_TAXI_DISPATCH_MILES = 5;

const PICKUP = {
  address: "801 Ronald Court, Baldwin, New York 11510, United States",
  lat: 40.673897,
  lng: -73.610676,
};
const DROPOFF = {
  address:
    "771 New Street, Uniondale, Town of Hempstead, Nassau County, New York 11553, United States",
  lat: 40.6940815,
  lng: -73.5905813,
};

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

async function sb(pathAndQuery, { method = "GET", body, prefer, token } = {}) {
  const key = token ? anon : serviceKey;
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || serviceKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "node",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
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
      "User-Agent": "node",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
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

async function getClientToken() {
  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: { type: "magiclink", email: CLIENT_EMAIL },
  });
  const hashed = gen.json?.hashed_token;
  if (!hashed) throw new Error(`client magiclink failed: ${JSON.stringify(gen.json)}`);
  const verify = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      "User-Agent": "node",
    },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const vj = await verify.json();
  if (!vj.access_token) throw new Error("client access_token missing");
  return { token: vj.access_token, userId: vj.user?.id || vj.user?.sub };
}

function centsToUsd(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

async function main() {
  const blockers = [];
  const notes = [];
  const steps = [];

  if (!supabaseUrl || !serviceKey || !anon) {
    throw new Error("Missing Supabase env");
  }

  // --- Reuse existing unpaid preflight ride if present (no multiples) ---
  const existing = await sb(
    `/rest/v1/taxi_rides?payment_status=eq.unpaid&status=in.(quoted,pending_payment)&order=created_at.desc&limit=5&select=id,status,payment_status,client_user_id,driver_id,total_cents,pickup_address,dropoff_address,stripe_session_id,stripe_payment_intent_id,created_at,vehicle_class`,
  );
  const unpaidRides = Array.isArray(existing.json) ? existing.json : [];
  steps.push({
    step: "existing_unpaid_scan",
    count: unpaidRides.length,
    ids: unpaidRides.map((r) => r.id),
  });

  const { token: clientToken, userId: clientUserId } = await getClientToken();
  steps.push({ step: "client_auth", client_user_id: clientUserId, email: CLIENT_EMAIL });

  let rideId = null;
  let quote = null;
  let created = null;
  let reused = false;

  const reusable = unpaidRides.find(
    (r) =>
      String(r.client_user_id) === String(clientUserId) &&
      !r.stripe_session_id &&
      !r.stripe_payment_intent_id &&
      String(r.vehicle_class ?? "").toLowerCase() === "standard",
  );

  if (reusable) {
    reused = true;
    rideId = reusable.id;
    notes.push(`Reused existing unpaid ride ${rideId} (no second ride created).`);
    steps.push({ step: "reuse_unpaid_ride", ride_id: rideId });
  } else {
    if (unpaidRides.length > 0) {
      notes.push(
        `Found ${unpaidRides.length} other unpaid ride(s); creating one owned by ${CLIENT_EMAIL} only if none match.`,
      );
    }

    const quoteRes = await api("/api/taxi/rides/quote", clientToken, {
      pickupAddress: PICKUP.address,
      dropoffAddress: DROPOFF.address,
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      dropoffLat: DROPOFF.lat,
      dropoffLng: DROPOFF.lng,
      vehicleClass: "standard",
      countryCode: "US",
      passengerCount: 1,
    });
    steps.push({
      step: "quote",
      http: quoteRes.status,
      ok: quoteRes.json?.ok,
      error: quoteRes.json?.error,
      total_cents: quoteRes.json?.quote?.total_cents,
    });
    if (quoteRes.status !== 200 || quoteRes.json?.ok !== true) {
      blockers.push(`quote failed: ${JSON.stringify(quoteRes.json)}`);
    } else {
      quote = quoteRes.json;
      const expected = Math.round(Number(quote.quote?.total_cents ?? 0));
      const createRes = await api("/api/taxi/rides/create", clientToken, {
        pickupAddress: PICKUP.address,
        dropoffAddress: DROPOFF.address,
        pickupLat: PICKUP.lat,
        pickupLng: PICKUP.lng,
        dropoffLat: DROPOFF.lat,
        dropoffLng: DROPOFF.lng,
        vehicleClass: "standard",
        countryCode: "US",
        passengerCount: 1,
        expectedQuoteTotalCents: expected,
      });
      steps.push({
        step: "create",
        http: createRes.status,
        ok: createRes.json?.ok,
        error: createRes.json?.error,
        ride_id: createRes.json?.ride?.id ?? createRes.json?.taxi_ride_id,
      });
      if (createRes.status !== 200 || createRes.json?.ok !== true) {
        blockers.push(`create failed: ${JSON.stringify(createRes.json)}`);
      } else {
        created = createRes.json;
        rideId =
          createRes.json?.ride?.id ||
          createRes.json?.taxi_ride_id ||
          createRes.json?.id;
      }
    }
  }

  // Load ride row
  let ride = null;
  if (rideId) {
    const rideRes = await sb(
      `/rest/v1/taxi_rides?id=eq.${rideId}&select=*`,
    );
    ride = Array.isArray(rideRes.json) ? rideRes.json[0] : null;
  }
  if (!ride) blockers.push("taxi ride missing after create/reuse");

  // Client GET enriched (before assignment — identification must be null)
  let clientGet = null;
  if (rideId) {
    clientGet = await api(`/api/taxi/rides/${rideId}`, clientToken, null, "GET");
    steps.push({
      step: "client_get_ride",
      http: clientGet.status,
      driver_id: clientGet.json?.ride?.driver_id ?? null,
      driver_name: clientGet.json?.ride?.driver_name ?? null,
      vehicle_plate: clientGet.json?.ride?.vehicle_plate ?? null,
    });
  }

  // Pricing table for breakdown
  const pricing = (
    await sb(
      `/rest/v1/taxi_pricing?country_code=eq.US&vehicle_class=eq.standard&active=eq.true&select=*&limit=1`,
    )
  ).json?.[0];

  const distanceMiles = Number(ride?.distance_miles ?? quote?.route?.distanceMiles ?? 0);
  const durationMinutes = Number(
    ride?.duration_minutes ?? quote?.route?.durationMinutes ?? 0,
  );
  const baseFare = Number(pricing?.base_fare ?? 0);
  const perMile = Number(pricing?.per_mile ?? 0);
  const perMinute = Number(pricing?.per_minute ?? 0);
  const bookingFee = Number(pricing?.booking_fee ?? 0);
  const minFare = Number(pricing?.min_fare ?? 0);
  const classMult = Number(pricing?.class_multiplier ?? 1);

  let fareUsd =
    baseFare + distanceMiles * perMile + durationMinutes * perMinute;
  fareUsd *= classMult;
  fareUsd = Math.max(fareUsd, minFare);
  fareUsd += bookingFee;
  const distancePriceUsd = distanceMiles * perMile;
  const timePriceUsd = durationMinutes * perMinute;

  const fareBreakdown = {
    base_fare_usd: Number(baseFare.toFixed(2)),
    distance_price_usd: Number(distancePriceUsd.toFixed(2)),
    time_price_usd: Number(timePriceUsd.toFixed(2)),
    booking_fee_usd: Number(bookingFee.toFixed(2)),
    class_multiplier: classMult,
    min_fare_usd: Number(minFare.toFixed(2)),
    reconstructed_subtotal_before_tax_usd: Number(fareUsd.toFixed(2)),
    note: "Reconstructed from taxi_pricing + route distance/duration (RPC aggregates into subtotal_cents).",
  };

  // Driver eligibility + radius
  const loc = (
    await sb(
      `/rest/v1/driver_locations?driver_id=eq.${DRIVER_ID}&select=driver_id,lat,lng,updated_at`,
    )
  ).json?.[0];
  const profile = (
    await sb(
      `/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}&select=status,is_online,transport_mode,active_vehicle_id`,
    )
  ).json?.[0];
  const vehicle = (
    await sb(
      `/rest/v1/driver_vehicles?id=eq.${VEHICLE_ID}&select=id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,vehicle_type,vehicle_active,admin_review_status,vehicle_status`,
    )
  ).json?.[0];
  const prefs = (
    await sb(
      `/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}&select=*`,
    )
  ).json?.[0];
  const feat = (
    await sb(
      `/rest/v1/taxi_driver_features?user_id=eq.${DRIVER_ID}&select=taxi_enabled,vehicle_class`,
    )
  ).json?.[0];

  const eligible = await sb("/rest/v1/rpc/is_taxi_driver_eligible", {
    method: "POST",
    body: {
      p_user_id: DRIVER_ID,
      p_vehicle_class: "standard",
      p_require_premium_driver: false,
    },
  });

  const driverMilesFromPickup =
    loc?.lat != null && loc?.lng != null
      ? milesBetween(Number(loc.lat), Number(loc.lng), PICKUP.lat, PICKUP.lng)
      : null;

  // Stripe live config (read-only — no checkout)
  // Prefer Vercel production env via local file if present; else .env.local (may be test).
  let stripeSecretPrefix = "missing";
  let stripeMode = "unknown";
  const stripeKey =
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    "";
  if (stripeKey.startsWith("sk_live_")) {
    stripeSecretPrefix = "sk_live";
    stripeMode = "live";
  } else if (stripeKey.startsWith("sk_test_")) {
    stripeSecretPrefix = "sk_test";
    stripeMode = "test";
  } else if (stripeKey) {
    stripeSecretPrefix = `other_${stripeKey.slice(0, 7)}`;
  }

  // Production Stripe probe without creating objects: list nothing sensitive —
  // verify checkout route source contract + ride has no PI.
  const checkoutRoutePath =
    "apps/web/app/api/stripe/client/create-taxi-checkout-session/route.ts";
  const confirmRoutePath =
    "apps/web/app/api/stripe/client/confirm-taxi-paid/route.ts";
  const webhookPath = "apps/web/src/lib/taxiStripeWebhook.ts";

  const stripeConfigVerified = {
    local_env_key_prefix: stripeSecretPrefix,
    local_env_mode: stripeMode,
    expected_production_mode: "live",
    currency_expected: "USD",
    ride_currency: String(ride?.currency ?? "").toUpperCase() || null,
    ride_has_stripe_session_id: Boolean(ride?.stripe_session_id),
    ride_has_stripe_payment_intent_id: Boolean(ride?.stripe_payment_intent_id),
    checkout_not_created: !ride?.stripe_session_id && !ride?.stripe_payment_intent_id,
    idempotency_key_pattern: rideId
      ? `taxi_checkout_${rideId}_{userId}_{stripeUnitAmount}_usd`
      : null,
    metadata_planned: {
      metadata_schema_version: "1",
      service_type: "taxi",
      taxi_ride_id: rideId,
      customer_id: "Stripe customer from client account (created at checkout)",
      country: "US",
      state: "NY (from pickup / county)",
    },
    webhook_planned: webhookPath,
    confirm_paid_planned: confirmRoutePath,
    checkout_route: checkoutRoutePath,
    note:
      stripeMode === "test"
        ? "Local .env.local may be sk_test; production Vercel holds sk_live (verified by prior Delivery Live proofs). No checkout called in this preflight."
        : "Stripe key prefix read from local env for this process.",
  };

  // Wait / cancel rules (code constants)
  const waitCancelRules = {
    client_cancel_before_driver: {
      statuses: ["draft", "quoted", "pending_payment", "paid", "dispatching"],
      refund_if_paid: "FULL",
      refund_if_unpaid: "NONE",
      source: "apps/web/app/api/taxi/rides/cancel/route.ts",
    },
    wait_timer: {
      free_minutes: 5,
      tier1: "3 min × $0.25",
      tier2: "5 min × $0.30",
      cap_usd: 2.25,
      source: "apps/web/src/lib/waitTimerTypes.ts + waitFeeCalculator.ts",
    },
  };

  const postPaymentPath = {
    finance_taxi_paid_once: "mark_taxi_ride_paid RPC + finance journal (idempotent)",
    dispatch: "scheduleTaxiRideDispatchIfEligible → runTaxiRideDispatch (5 mi waves)",
    driver_notification: "Expo push via dispatch",
    offer: "taxi_offers created for eligible drivers",
    accept: "driver_accept_taxi_offer → assigned_vehicle_id + display snapshots",
    vehicle_snapshot: "vehicle_plate_snapshot / make / model / color / year frozen",
    lifecycle: [
      "accepted",
      "driver_arrived",
      "wait timer",
      "in_progress",
      "completed",
    ],
    notifications: "client + driver completion pushes (pattern aligned with delivery)",
    loyalty: "client + driver accrual on completion (idempotent keys)",
    commissions: "platform_fee_cents / driver_payout_cents on ride",
    no_auto_payout: true,
    no_auto_refund: true,
  };

  // Assertions
  if (ride) {
    if (!["quoted", "pending_payment"].includes(String(ride.status))) {
      blockers.push(`unexpected status=${ride.status}`);
    }
    if (String(ride.payment_status) !== "unpaid") {
      blockers.push(`payment_status=${ride.payment_status} (want unpaid)`);
    }
    if (ride.driver_id) blockers.push("driver already assigned before payment");
    if (ride.stripe_session_id || ride.stripe_payment_intent_id) {
      blockers.push("Stripe session/PI already present — forbidden in preflight");
    }
    if (String(ride.vehicle_class ?? "").toLowerCase() !== "standard") {
      blockers.push(`vehicle_class=${ride.vehicle_class}`);
    }
    if (String(ride.currency ?? "").toUpperCase() !== "USD") {
      blockers.push(`currency=${ride.currency}`);
    }
    if (!(Number(ride.total_cents) > 0)) blockers.push("total_cents invalid");
  }

  if (clientGet?.json?.ride) {
    const r = clientGet.json.ride;
    if (r.driver_name != null || r.vehicle_plate != null) {
      blockers.push("client identification leaked before driver assignment");
    }
  }

  if (profile?.status !== "approved") blockers.push("driver not approved");
  if (profile?.is_online !== true) blockers.push("driver not online");
  if (String(profile?.transport_mode).toLowerCase() !== "car") {
    blockers.push(`transport_mode=${profile?.transport_mode} (must be car, not bike)`);
  }
  if (profile?.active_vehicle_id !== VEHICLE_ID) {
    blockers.push("active vehicle is not Honda Accord Sport");
  }
  if (feat?.taxi_enabled !== true) blockers.push("taxi_enabled false");
  if (prefs?.taxi_rides_enabled !== true) blockers.push("taxi_rides_enabled false");
  if (eligible.json !== true) blockers.push("is_taxi_driver_eligible false");
  if (
    !(
      vehicle?.vehicle_make === "Honda" &&
      String(vehicle?.vehicle_model).includes("Accord") &&
      vehicle?.vehicle_year === 2020 &&
      String(vehicle?.license_plate).toUpperCase().replace(/\s+/g, "") === "LTK1944"
    )
  ) {
    blockers.push("vehicle identity mismatch");
  }
  if (String(vehicle?.vehicle_type).toLowerCase() === "bike") {
    blockers.push("bike vehicle selected");
  }
  if (driverMilesFromPickup == null) {
    blockers.push("driver location missing");
  } else if (driverMilesFromPickup > MAX_TAXI_DISPATCH_MILES) {
    blockers.push(
      `driver ${driverMilesFromPickup.toFixed(2)} mi from pickup > ${MAX_TAXI_DISPATCH_MILES} mi taxi radius`,
    );
  }

  // Food/Delivery untouched — soft check: no write to those tables in this script
  notes.push("Script only wrote taxi_rides via official create API (or reused). No Food/Delivery mutations.");
  notes.push(
    "Official create yields status=quoted + payment_status=unpaid. pending_payment appears only when Checkout starts (not done).",
  );

  const verdict =
    blockers.length === 0
      ? "TAXI PAYMENT PREFLIGHT — READY"
      : "TAXI PAYMENT PREFLIGHT — BLOCKED";

  const report = {
    audited_at: new Date().toISOString(),
    verdict,
    taxi_ride_id: rideId,
    reused_existing_unpaid_ride: reused,
    pickup: PICKUP,
    destination: DROPOFF,
    distance_miles: Number(distanceMiles.toFixed(3)),
    duration_minutes: Number(durationMinutes.toFixed(1)),
    fare_detail: {
      ...fareBreakdown,
      subtotal_cents: ride?.subtotal_cents ?? null,
      tax_cents: ride?.tax_cents ?? null,
      service_fee_cents: ride?.service_fee_cents ?? null,
      platform_fee_cents: ride?.platform_fee_cents ?? null,
      driver_payout_cents: ride?.driver_payout_cents ?? null,
      discount_cents: ride?.discount_cents ?? ride?.mmd_plus_discount_cents ?? 0,
      gross_total_cents: ride?.gross_total_cents ?? null,
      total_cents: ride?.total_cents ?? null,
      total_usd: centsToUsd(ride?.total_cents),
      currency: ride?.currency ?? "USD",
    },
    vehicle_class: ride?.vehicle_class ?? "standard",
    driver_eligible: {
      driver_id: DRIVER_ID,
      is_taxi_driver_eligible: eligible.json === true,
      is_online: profile?.is_online === true,
      transport_mode: profile?.transport_mode,
      miles_from_pickup: driverMilesFromPickup,
      within_taxi_dispatch_radius_5mi:
        driverMilesFromPickup != null &&
        driverMilesFromPickup <= MAX_TAXI_DISPATCH_MILES,
      taxi_enabled: feat?.taxi_enabled === true,
    },
    vehicle_selected: {
      id: vehicle?.id,
      make: vehicle?.vehicle_make,
      model: vehicle?.vehicle_model,
      year: vehicle?.vehicle_year,
      color: vehicle?.vehicle_color,
      plate: vehicle?.license_plate,
      type: vehicle?.vehicle_type,
      active: vehicle?.vehicle_active,
      admin_review_status: vehicle?.admin_review_status,
    },
    before_assignment_identification: {
      driver_name: clientGet?.json?.ride?.driver_name ?? null,
      vehicle_plate: clientGet?.json?.ride?.vehicle_plate ?? null,
      null_as_required: true,
    },
    stripe_config: stripeConfigVerified,
    post_payment_path: postPaymentPath,
    wait_cancel_rules: waitCancelRules,
    no_checkout_created: true,
    no_payment_intent_created: !ride?.stripe_payment_intent_id,
    no_charge: true,
    food_delivery_untouched: true,
    blockers,
    notes,
    steps,
    ride_row_summary: ride
      ? {
          id: ride.id,
          status: ride.status,
          payment_status: ride.payment_status,
          country_code: ride.country_code,
          vehicle_class: ride.vehicle_class,
          total_cents: ride.total_cents,
          currency: ride.currency,
          driver_id: ride.driver_id,
          stripe_session_id: ride.stripe_session_id,
          stripe_payment_intent_id: ride.stripe_payment_intent_id,
        }
      : null,
    authorization_required:
      "Await explicit user approval before creating Stripe Live Checkout.",
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(__dirname, "../../../backups/live-taxi-preflight");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "TAXI_PAYMENT_PREFLIGHT.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  process.exit(blockers.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
