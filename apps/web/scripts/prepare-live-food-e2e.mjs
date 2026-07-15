#!/usr/bin/env node
/**
 * Prepare a Live Food E2E checkout and STOP before any card entry.
 *
 * Creates:
 *   1) Food quote (server pricing)
 *   2) Unpaid food order
 *   3) Stripe Checkout Session (Live expected)
 *
 * Never confirms payment and never enters a card.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (or publishable)
 *   SUPABASE_SERVICE_ROLE_KEY (preferred for restaurant lookup)
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD
 *   STRIPE_SECRET_KEY (must be sk_live_… in Live)
 *
 * Optional:
 *   API_BASE_URL (default https://www.mmddelivery.com)
 *   E2E_RESTAURANT_NAME
 *   E2E_SCOPE_COUNTRY
 *
 * Run:
 *   node apps/web/scripts/prepare-live-food-e2e.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

try {
  const dotenv = require("dotenv");
  dotenv.config({ path: join(__dirname, "..", "..", "..", ".env.local") });
  dotenv.config({ path: join(__dirname, "..", ".env.local") });
  dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });
} catch {
  /* optional */
}

const apiBase = (
  process.env.API_BASE_URL ||
  process.env.SMOKE_API_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).trim();
const anonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ""
).trim();
const serviceKey = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();
const stripeSecret = (process.env.STRIPE_SECRET_KEY || "").trim();
const testEmail =
  process.env.E2E_TEST_EMAIL ||
  process.env.TEST_LOGIN_EMAIL ||
  "";
const testPassword =
  process.env.E2E_TEST_PASSWORD ||
  process.env.TEST_LOGIN_PASSWORD ||
  "";

const RESTAURANT_NAME_HINT =
  process.env.E2E_RESTAURANT_NAME || "Fouta halal";
const SCOPE_COUNTRY = process.env.E2E_SCOPE_COUNTRY || "US";

function maskId(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= 12) return `${text.slice(0, 4)}…`;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function failFatal(message) {
  console.error(`\nFATAL: ${message}`);
  process.exit(2);
}

async function authClient() {
  if (!supabaseUrl || !anonKey) failFatal("Missing Supabase URL / anon key");
  if (!testEmail || !testPassword) {
    failFatal("Missing E2E_TEST_EMAIL / E2E_TEST_PASSWORD");
  }
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (error || !data.session?.access_token) {
    failFatal(`Client auth failed: ${error?.message ?? "no session"}`);
  }
  return {
    token: data.session.access_token,
    userId: data.user.id,
  };
}

function adminClient() {
  if (!serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function api(token, path, body) {
  const qs = new URLSearchParams({ country: SCOPE_COUNTRY });
  const res = await fetch(`${apiBase}${path}?${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function stripeGet(path) {
  if (!stripeSecret) throw new Error("STRIPE_SECRET_KEY missing");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${stripeSecret}` },
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function reverseLabel(lat, lng) {
  const token = (
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    ""
  ).trim();
  if (!token) return null;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?types=address,poi,place,locality,neighborhood&limit=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) return null;
  return String(json?.features?.[0]?.place_name ?? "").trim() || null;
}

async function ensureMinimalClientProfile(admin, userId, dropoff) {
  if (!admin) return { updated: false, reason: "no_service_role" };
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, role, full_name, phone, default_address, default_lat, default_lng, country_code")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile) {
    return { updated: false, reason: error?.message || "profile_missing" };
  }

  const patch = {};
  if (!String(profile.full_name ?? "").trim()) patch.full_name = "E2E Live Food Client";
  if (!String(profile.phone ?? "").trim()) patch.phone = "+15165550100";
  if (!String(profile.default_address ?? "").trim()) {
    patch.default_address = dropoff.address;
  }
  if (!Number.isFinite(Number(profile.default_lat))) patch.default_lat = dropoff.lat;
  if (!Number.isFinite(Number(profile.default_lng))) patch.default_lng = dropoff.lng;
  if (!String(profile.country_code ?? "").trim()) patch.country_code = SCOPE_COUNTRY;
  if (String(profile.role ?? "").toLowerCase() !== "client") {
    // Do not force role changes in Live; only report.
    return {
      updated: false,
      reason: `role_is_${profile.role ?? "null"}`,
      profile_ready: Object.keys(patch).length === 0,
    };
  }

  if (Object.keys(patch).length === 0) {
    return { updated: false, reason: "already_complete", profile_ready: true };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", userId);
  if (updateError) {
    return { updated: false, reason: updateError.message, profile_ready: false };
  }
  return {
    updated: true,
    fields: Object.keys(patch),
    profile_ready: true,
  };
}

async function main() {
  console.log("=== Prepare Live Food E2E (no card entry) ===");
  console.log(`API: ${apiBase}`);
  console.log(`Client: ${testEmail || "(missing)"}`);
  console.log(
    `Stripe secret prefix: ${
      stripeSecret ? stripeSecret.slice(0, 8) + "…" : "NO"
    }`,
  );

  const localStripeIsLive = stripeSecret.startsWith("sk_live_");
  if (stripeSecret && !localStripeIsLive) {
    console.log(
      "NOTE: local STRIPE_SECRET_KEY is not sk_live_. Checkout livemode will be verified from production API response / cs_live_ URL.",
    );
  }

  const { token, userId } = await authClient();
  const admin = adminClient();

  const reader = admin ?? createClient(supabaseUrl, anonKey);
  const { data: restaurants, error: restErr } = await reader
    .from("restaurant_profiles")
    .select(
      "user_id, restaurant_name, address, location_lat, location_lng, status, is_accepting_orders",
    )
    .eq("status", "approved")
    .eq("is_accepting_orders", true)
    .ilike("restaurant_name", `%${RESTAURANT_NAME_HINT}%`)
    .limit(1);

  if (restErr || !restaurants?.[0]) {
    failFatal(`Restaurant not found: ${restErr?.message || RESTAURANT_NAME_HINT}`);
  }
  const restaurant = restaurants[0];

  const { data: items, error: itemsErr } = await reader
    .from("restaurant_items")
    .select("id, name, price_cents, is_available, category")
    .eq("restaurant_user_id", restaurant.user_id)
    .eq("is_available", true)
    .order("price_cents", { ascending: true })
    .limit(2);

  if (itemsErr || !items?.length) {
    failFatal(`No available menu item: ${itemsErr?.message || "empty"}`);
  }

  const pickupLat = Number(restaurant.location_lat);
  const pickupLng = Number(restaurant.location_lng);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    failFatal("Restaurant coordinates missing — cannot build trusted pickup");
  }

  // Keep dropoff near restaurant for a valid paid route, but use reverse-geocoded
  // labels so address text matches pin evidence (anti-spoof stays enforced).
  const dropoffLat = pickupLat + 0.015;
  const dropoffLng = pickupLng + 0.01;
  const [pickupLabel, dropoffLabel] = await Promise.all([
    reverseLabel(pickupLat, pickupLng),
    reverseLabel(dropoffLat, dropoffLng),
  ]);

  const pickupAddress =
    pickupLabel ||
    String(restaurant.address ?? "").trim() ||
    `Restaurant pickup (${pickupLat.toFixed(5)}, ${pickupLng.toFixed(5)})`;
  const dropoffAddress =
    dropoffLabel ||
    `Delivery destination near restaurant (${dropoffLat.toFixed(5)}, ${dropoffLng.toFixed(5)})`;

  const profilePrep = await ensureMinimalClientProfile(admin, userId, {
    address: dropoffAddress,
    lat: dropoffLat,
    lng: dropoffLng,
  });
  console.log(
    JSON.stringify({
      profile_prep: {
        updated: profilePrep.updated,
        reason: profilePrep.reason,
        fields: profilePrep.fields ?? null,
        profile_ready: profilePrep.profile_ready ?? null,
      },
      geo_coherence: {
        pickup_label_source: pickupLabel ? "reverse_geocode" : "restaurant_or_fallback",
        dropoff_label_source: dropoffLabel ? "reverse_geocode" : "fallback",
      },
    }),
  );

  const orderItems = items.slice(0, 1).map((item) => ({
    item_id: item.id,
    quantity: 1,
  }));

  const orderBody = {
    restaurant_id: restaurant.user_id,
    restaurant_user_id: restaurant.user_id,
    restaurant_name: restaurant.restaurant_name,
    pickup_address: pickupAddress,
    dropoff_address: dropoffAddress,
    pickup_lat: pickupLat,
    pickup_lng: pickupLng,
    dropoff_lat: dropoffLat,
    dropoff_lng: dropoffLng,
    items: orderItems,
  };

  const quote = await api(token, "/api/orders/food/quote", orderBody);
  if (!(quote.res.ok && quote.json?.ok === true && quote.json?.quote)) {
    failFatal(
      `Quote failed: ${quote.json?.error || quote.json?.message || quote.res.status}`,
    );
  }
  const q = quote.json.quote;

  const create = await api(token, "/api/orders/food/create", orderBody);
  if (!(create.res.ok && create.json?.ok === true && create.json?.order_id)) {
    failFatal(
      `Create failed: ${create.json?.error || create.json?.message || create.res.status}`,
    );
  }
  const orderId = String(create.json.order_id);
  const pricing = create.json.pricing ?? q;

  const checkout = await api(token, "/api/stripe/client/create-checkout-session", {
    order_id: orderId,
  });
  if (!checkout.res.ok) {
    failFatal(
      `Checkout failed: ${checkout.json?.error || checkout.json?.message || checkout.res.status}`,
    );
  }

  const checkoutUrl =
    checkout.json?.checkout_url || checkout.json?.url || null;
  let sessionId =
    checkout.json?.session_id ||
    checkout.json?.checkout_session_id ||
    checkout.json?.id ||
    null;
  let paymentIntentId =
    checkout.json?.payment_intent_id ||
    checkout.json?.paymentIntentId ||
    null;

  if (!sessionId && typeof checkoutUrl === "string") {
    const match = checkoutUrl.match(/\/(cs_(?:live|test)_[A-Za-z0-9]+)/);
    if (match) sessionId = match[1];
  }

  let livemode = null;
  let sessionStatus = null;
  let amountTotal = null;
  let currency = pricing.currency ?? null;
  let paymentStatus = "unpaid";

  if (sessionId && localStripeIsLive) {
    const session = await stripeGet(
      `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
    );
    if (!session.res.ok) {
      failFatal(`Stripe session fetch failed: ${session.json?.error?.message}`);
    }
    livemode = session.json.livemode === true;
    sessionStatus = session.json.status ?? null;
    amountTotal = session.json.amount_total ?? null;
    currency = String(session.json.currency || currency || "").toUpperCase();
    paymentStatus = session.json.payment_status ?? paymentStatus;
    if (!paymentIntentId) {
      const pi = session.json.payment_intent;
      paymentIntentId =
        typeof pi === "string" ? pi : pi?.id ? String(pi.id) : null;
    }
  } else if (typeof checkoutUrl === "string" && checkoutUrl.includes("cs_live_")) {
    livemode = true;
  } else if (typeof sessionId === "string" && sessionId.startsWith("cs_live_")) {
    livemode = true;
  } else if (checkout.json?.livemode === true) {
    livemode = true;
  }

  if (livemode !== true) {
    failFatal("Checkout Session is not livemode=true — aborting Live E2E prep");
  }

  let orderRow = null;
  if (admin) {
    const { data } = await admin
      .from("orders")
      .select(
        "id, payment_status, status, total, tax, delivery_fee, service_fee, currency, distance_miles, pickup_address, dropoff_address, restaurant_name, driver_id",
      )
      .eq("id", orderId)
      .maybeSingle();
    orderRow = data;
  }

  const driverShare =
    Number(pricing.driver_payout_estimate ?? pricing.driverPayoutEstimate ?? NaN);
  const deliveryFee = Number(pricing.delivery_fee ?? pricing.deliveryFee ?? NaN);
  const platformShare = Number.isFinite(deliveryFee) && Number.isFinite(driverShare)
    ? Number((deliveryFee - driverShare).toFixed(2))
    : null;

  const distanceMiles = Number(
    pricing.distance_miles ?? pricing.distanceMiles ?? NaN,
  );
  const etaMinutes = Number(pricing.eta_minutes ?? pricing.etaMinutes ?? NaN);
  let deliveryFormula = null;
  if (admin) {
    const configKey = String(pricing.config_key ?? pricing.configKey ?? "food_default");
    const { data: cfg } = await admin
      .from("pricing_config")
      .select(
        "config_key, delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute, delivery_driver_pct, delivery_platform_pct",
      )
      .eq("config_key", configKey)
      .eq("active", true)
      .maybeSingle();
    if (cfg) {
      const base = Number(cfg.delivery_fee_base);
      const perMile = Number(cfg.delivery_fee_per_mile);
      const perMinute = Number(cfg.delivery_fee_per_minute);
      const raw =
        base +
        (Number.isFinite(distanceMiles) ? distanceMiles * perMile : 0) +
        (Number.isFinite(etaMinutes) ? etaMinutes * perMinute : 0);
      deliveryFormula = {
        config_key: cfg.config_key,
        delivery_fee_base: base,
        delivery_fee_per_mile: perMile,
        delivery_fee_per_minute: perMinute,
        delivery_minimum_fee: 3.49,
        delivery_driver_pct: Number(cfg.delivery_driver_pct),
        delivery_platform_pct: Number(cfg.delivery_platform_pct),
        formula: `${base} + ${distanceMiles}*${perMile} + ${etaMinutes}*${perMinute}`,
        raw_before_minimum: Number(raw.toFixed(4)),
        delivery_fee_applied: deliveryFee,
        driver_share_applied: Number.isFinite(driverShare) ? driverShare : null,
        platform_share_applied: platformShare,
        promo_code: pricing.promo_code_applied ?? pricing.promoCodeApplied ?? null,
        free_delivery_rule: false,
      };
    }
  }

  if (!(Number.isFinite(deliveryFee) && deliveryFee > 0)) {
    failFatal(
      `Refusing Live checkout with delivery_fee=${deliveryFee}. Fix pricing_config before payment.`,
    );
  }

  const report = {
    prepared_at: new Date().toISOString(),
    api_base: apiBase,
    client_user_id_masked: maskId(userId),
    restaurant: {
      name: restaurant.restaurant_name,
      user_id_masked: maskId(restaurant.user_id),
      address: restaurant.address,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
    },
    products: items.slice(0, 1).map((item) => ({
      id_masked: maskId(item.id),
      name: item.name,
      category: item.category ?? null,
      unit_price_cents: item.price_cents,
      quantity: 1,
    })),
    destination: {
      address: dropoffAddress,
      lat: dropoffLat,
      lng: dropoffLng,
    },
    server_pricing: {
      distance_miles: pricing.distance_miles ?? pricing.distanceMiles ?? null,
      eta_minutes: pricing.eta_minutes ?? pricing.etaMinutes ?? null,
      subtotal: pricing.subtotal ?? null,
      tax: pricing.tax ?? null,
      tax_rate_pct: pricing.tax_rate_pct ?? pricing.taxRatePct ?? null,
      delivery_fee: deliveryFee,
      service_fee: pricing.service_fee ?? pricing.serviceFee ?? null,
      driver_share: Number.isFinite(driverShare) ? driverShare : null,
      platform_share: platformShare,
      total: pricing.total ?? null,
      total_cents: pricing.total_cents ?? pricing.totalCents ?? amountTotal,
      currency: currency,
      config_key: pricing.config_key ?? pricing.configKey ?? null,
    },
    delivery_formula: deliveryFormula,
    amounts_match: {
      quote_total: pricing.total ?? null,
      order_total: orderRow?.total ?? null,
      checkout_amount_total_cents: amountTotal,
      currency,
    },
    order: {
      id_masked: maskId(orderId),
      id_full_local_file_only: orderId,
      payment_status: orderRow?.payment_status ?? "unpaid",
      status: orderRow?.status ?? "pending",
      driver_id: orderRow?.driver_id ?? null,
    },
    stripe: {
      checkout_session_id_masked: maskId(sessionId),
      payment_intent_id_masked: maskId(paymentIntentId),
      checkout_url: checkoutUrl,
      livemode: true,
      session_status: sessionStatus,
      payment_status: paymentStatus,
      amount_total_cents: amountTotal,
      currency,
    },
    human_action_required:
      "Open checkout_url and pay yourself. Do not ask the agent to enter card details.",
  };

  const outDir = join(__dirname, "..", ".tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "live-food-e2e-prep.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n================ LIVE FOOD PREP READY ================");
  console.log(JSON.stringify({
    restaurant: report.restaurant.name,
    products: report.products,
    pickup: report.restaurant.address,
    destination: report.destination.address,
    distance_miles: report.server_pricing.distance_miles,
    subtotal: report.server_pricing.subtotal,
    tax: report.server_pricing.tax,
    delivery_fee: report.server_pricing.delivery_fee,
    service_fee: report.server_pricing.service_fee,
    driver_share: report.server_pricing.driver_share,
    platform_share: report.server_pricing.platform_share,
    total: report.server_pricing.total,
    currency: report.server_pricing.currency,
    order_id_masked: report.order.id_masked,
    checkout_session_masked: report.stripe.checkout_session_id_masked,
    payment_intent_masked: report.stripe.payment_intent_id_masked,
    livemode: report.stripe.livemode,
    checkout_url: report.stripe.checkout_url,
    payment_status: report.order.payment_status,
    delivery_formula: report.delivery_formula ?? null,
  }, null, 2));
  console.log(`\nSaved: ${outPath}`);
  console.log("WAITING FOR HUMAN PAYMENT — no card was entered by the agent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
