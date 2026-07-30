/**
 * Create Fresh Live Checkout URLs for founder card entry.
 * No wait loop. Writes URLs under docs/production/reports/.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.join(root, "apps/web/.env.local") });
require("dotenv").config({
  path: path.join(root, "docs/production/final-certification.env"),
  override: false,
});

const SITE = "https://www.mmddelivery.com";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.E2E_TEST_EMAIL || "e2e.enterprise-cert@mmd.test";
const PASSWORD =
  process.env.E2E_TEST_PASSWORD || "E2eEnterpriseCert!Mmd2026";
const outDir = path.join(root, "docs/production/reports");
fs.mkdirSync(outDir, { recursive: true });

async function authFetch(token, pathname, options = {}) {
  const res = await fetch(`${SITE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function reverseGeocode(lat, lng) {
  const token =
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    "";
  if (!token) return null;
  const u =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?types=address,poi,place&limit=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(u);
  const json = await res.json().catch(() => null);
  return String(json?.features?.[0]?.place_name ?? "").trim() || null;
}

const report = { generatedAt: new Date().toISOString(), checkouts: [] };

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
let user = listed.data?.users?.find((u) => u.email === EMAIL);
if (!user) {
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  user = created.data.user;
} else {
  await admin.auth.admin.updateUserById(user.id, {
    password: PASSWORD,
    email_confirm: true,
  });
}
await admin.from("profiles").upsert({
  id: user.id,
  role: "client",
  full_name: "Enterprise Cert Client",
  phone: "+12125550199",
  country_code: "US",
  default_lat: 40.7128,
  default_lng: -74.006,
  default_address: "Enterprise Cert NYC",
});

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: sess, error: signErr } = await client.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signErr) throw signErr;
const token = sess.session.access_token;

// Cancel any unpaid open taxi rides for this user to avoid clutter
{
  const { data: open } = await admin
    .from("taxi_rides")
    .select("id,payment_status,status")
    .eq("client_user_id", user.id)
    .in("payment_status", ["unpaid", "pending"])
    .limit(10);
  for (const r of open || []) {
    await authFetch(token, "/api/taxi/rides/cancel", {
      method: "POST",
      body: JSON.stringify({ rideId: r.id }),
    });
  }
}

// TAXI — pay-then-create (no taxi_rides row until Stripe confirms payment)
{
  const quote = await authFetch(token, "/api/taxi/rides/quote", {
    method: "POST",
    body: JSON.stringify({
      pickupLat: 40.758,
      pickupLng: -73.9855,
      dropoffLat: 40.7484,
      dropoffLng: -73.9857,
      countryCode: "US",
      vehicleClass: "standard",
    }),
  });
  if (!quote.body?.ok) throw new Error("taxi quote failed " + JSON.stringify(quote.body));
  const totalCents = Number(quote.body.quote.total_cents);
  const checkout = await authFetch(
    token,
    "/api/stripe/client/create-taxi-quote-checkout-session",
    {
      method: "POST",
      body: JSON.stringify({
        pickupLat: 40.758,
        pickupLng: -73.9855,
        dropoffLat: 40.7484,
        dropoffLng: -73.9857,
        countryCode: "US",
        vehicleClass: "standard",
        expectedQuoteTotalCents: totalCents,
      }),
    }
  );
  const checkoutUrl =
    checkout.body?.url ||
    checkout.body?.checkout_url ||
    checkout.body?.session?.url;
  const entry = {
    flow: "taxi",
    pay_then_create: true,
    amount_cents: totalCents,
    currency: "USD",
    entity_id: null,
    quote_checkout_id: checkout.body?.quote_checkout_id || null,
    taxi_ride_id: checkout.body?.taxi_ride_id ?? null,
    session_id: checkout.body?.session_id || checkout.body?.id,
    url: checkoutUrl,
    httpStatus: checkout.res.status,
    error: checkout.body?.error,
  };
  if (entry.taxi_ride_id) {
    throw new Error("pay-then-create violated: taxi_ride_id present before payment");
  }
  report.checkouts.push(entry);
  fs.writeFileSync(path.join(outDir, "enterprise-taxi-checkout.url.txt"), checkoutUrl || "", "utf8");
  console.log(JSON.stringify(entry, null, 2));
}

// FOOD
{
  const { data: restaurants } = await admin
    .from("restaurant_profiles")
    .select("user_id,restaurant_name,address,location_lat,location_lng")
    .eq("status", "approved")
    .eq("is_accepting_orders", true)
    .not("location_lat", "is", null)
    .not("location_lng", "is", null)
    .limit(1);
  const restaurant = restaurants?.[0];
  if (restaurant) {
    const { data: items } = await admin
      .from("restaurant_items")
      .select("id,name,price_cents")
      .eq("restaurant_user_id", restaurant.user_id)
      .eq("is_available", true)
      .order("price_cents", { ascending: true })
      .limit(1);
    const menuItem = items?.[0];
    if (menuItem) {
      const pickupLat = Number(restaurant.location_lat);
      const pickupLng = Number(restaurant.location_lng);
      const dropoffLat = pickupLat + 0.012;
      const dropoffLng = pickupLng + 0.008;
      const [pickupLabel, dropoffLabel] = await Promise.all([
        reverseGeocode(pickupLat, pickupLng),
        reverseGeocode(dropoffLat, dropoffLng),
      ]);
      const qs = "country=US";
      const orderBody = {
        restaurant_id: restaurant.user_id,
        restaurant_user_id: restaurant.user_id,
        restaurant_name: restaurant.restaurant_name,
        pickup_address: pickupLabel || restaurant.address,
        dropoff_address: dropoffLabel || `Near ${restaurant.restaurant_name}`,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        items: [{ item_id: menuItem.id, quantity: 1 }],
      };
      const quote = await authFetch(token, `/api/orders/food/quote?${qs}`, {
        method: "POST",
        body: JSON.stringify(orderBody),
      });
      if (quote.body?.ok) {
        const create = await authFetch(token, `/api/orders/food/create?${qs}`, {
          method: "POST",
          body: JSON.stringify(orderBody),
        });
        const orderId = create.body?.order?.id || create.body?.order_id;
        if (orderId) {
          const checkout = await authFetch(
            token,
            `/api/stripe/client/create-checkout-session?${qs}`,
            {
              method: "POST",
              body: JSON.stringify({ orderId, order_id: orderId }),
            }
          );
          const checkoutUrl =
            checkout.body?.url ||
            checkout.body?.checkout_url ||
            checkout.body?.session?.url;
          const entry = {
            flow: "food",
            amount: quote.body?.quote?.total,
            currency: quote.body?.quote?.currency,
            entity_id: orderId,
            restaurant: restaurant.restaurant_name,
            item: menuItem.name,
            price_cents: menuItem.price_cents,
            session_id: checkout.body?.session_id || checkout.body?.id,
            url: checkoutUrl,
            httpStatus: checkout.res.status,
            error: checkout.body?.error,
          };
          report.checkouts.push(entry);
          fs.writeFileSync(
            path.join(outDir, "enterprise-food-checkout.url.txt"),
            checkoutUrl || "",
            "utf8"
          );
          console.log(JSON.stringify(entry, null, 2));
        } else {
          report.checkouts.push({
            flow: "food",
            error: create.body?.error || "create_failed",
            body: create.body,
          });
        }
      } else {
        report.checkouts.push({
          flow: "food",
          error: quote.body?.error || "quote_failed",
          body: quote.body,
        });
      }
    }
  }
}

// MMD Plus
{
  const sum = await authFetch(token, "/api/mmd-plus/summary");
  const plans = sum.body?.plans || [];
  const plan = plans.find((p) => p.stripe_price_id) || plans[0];
  if (plan?.id) {
    const plus = await authFetch(token, "/api/mmd-plus/actions", {
      method: "POST",
      body: JSON.stringify({ action: "checkout", plan_id: plan.id }),
    });
    const checkoutUrl =
      plus.body?.url || plus.body?.checkout_url || plus.body?.session?.url;
    const entry = {
      flow: "mmd_plus",
      plan_id: plan.id,
      plan_name: plan.name,
      url: checkoutUrl,
      httpStatus: plus.res.status,
      error: plus.body?.error,
    };
    report.checkouts.push(entry);
    if (checkoutUrl) {
      fs.writeFileSync(
        path.join(outDir, "enterprise-mmd-plus-checkout.url.txt"),
        checkoutUrl,
        "utf8"
      );
    }
    console.log(JSON.stringify(entry, null, 2));
  }
}

fs.writeFileSync(
  path.join(outDir, "enterprise-live-checkouts.json"),
  JSON.stringify(report, null, 2)
);
console.log("Wrote", path.join(outDir, "enterprise-live-checkouts.json"));
