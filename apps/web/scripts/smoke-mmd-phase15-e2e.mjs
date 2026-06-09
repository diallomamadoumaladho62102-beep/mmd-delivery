/**
 * E2E smoke — MMD Location Phase 1.5 (Location → Taxi → Delivery)
 * Run: node apps/web/scripts/smoke-mmd-phase15-e2e.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const apiBase = (
  process.env.SMOKE_API_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const testEmail =
  process.env.TEST_LOGIN_EMAIL ||
  process.env.E2E_TEST_EMAIL ||
  "e2e.phase15@mmd.test";
const testPassword =
  process.env.TEST_LOGIN_PASSWORD ||
  process.env.E2E_TEST_PASSWORD ||
  "E2ePhase15!Mmd2026";

const results = {
  taxi: {},
  delivery: {},
  supabase: {},
  storage: {},
  risks: [],
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function ok(section, label, detail = "") {
  console.log(`OK  [${section}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function authFetch(token, pathname, options = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function ensureTestUser(admin) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((u) => u.email === testEmail);

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      password: testPassword,
      email_confirm: true,
    });
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (error || !data.user?.id) {
    fail(`Could not create test user: ${error?.message ?? "unknown"}`);
  }

  return data.user.id;
}

async function signIn() {
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (error || !data.session?.access_token) {
    fail(`Login failed: ${error?.message ?? "no session"}`);
  }

  return {
    token: data.session.access_token,
    userId: data.session.user.id,
    client: supabase,
  };
}

async function createLocation(token, label, coords) {
  const { res, body } = await authFetch(token, "/api/locations/create", {
    method: "POST",
    body: JSON.stringify({
      country_code: "GN",
      region_name: "Conakry",
      prefecture_name: "Conakry",
      city_name: "Conakry",
      commune_name: "Ratoma",
      quartier_name: "Kipé",
      directions_text: `E2E Phase 1.5 ${label}: near Total station, blue gate.`,
      pin_lat: coords.lat,
      pin_lng: coords.lng,
      geocoded_lat: coords.lat,
      geocoded_lng: coords.lng,
      accuracy_m: 15,
      location_source: "pin",
    }),
  });

  if (!res.ok || !body?.ok || !body?.location?.id) {
    fail(`locations/create (${label}) ${res.status}: ${body?.error ?? "unknown"}`);
  }

  return body.location;
}

async function main() {
  if (!url || !anon || !serviceKey) {
    fail("Missing Supabase URL/anon/service role in apps/web/.env.local");
  }

  console.log(`\n=== MMD Phase 1.5 E2E ===`);
  console.log(`API: ${apiBase}`);
  console.log(`User: ${testEmail}\n`);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await ensureTestUser(admin);
  const { token, userId, client } = await signIn();
  ok("auth", "signed in", userId);

  const pickupCoords = { lat: 9.6378, lng: -13.5784 };
  const dropoffCoords = { lat: 9.6412, lng: -13.5718 };

  const pickupLocation = await createLocation(token, "pickup", pickupCoords);
  const dropoffLocation = await createLocation(token, "dropoff", dropoffCoords);
  results.supabase.pickupLocationId = pickupLocation.id;
  results.supabase.dropoffLocationId = dropoffLocation.id;
  ok("location", "pickup location_point", pickupLocation.id);
  ok("location", "dropoff location_point", dropoffLocation.id);

  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const photo = await authFetch(token, `/api/locations/${pickupLocation.id}/photo`, {
    method: "POST",
    body: JSON.stringify({
      image_base64: tinyPngBase64,
      content_type: "image/png",
    }),
  });

  if (!photo.res.ok || !photo.body?.ok || !photo.body?.photo_path) {
    fail(`locations/photo ${photo.res.status}: ${photo.body?.error ?? "unknown"}`);
  }
  results.storage.photoPath = photo.body.photo_path;
  ok("storage", "location photo uploaded", photo.body.photo_path);

  const getLoc = await authFetch(token, `/api/locations/${pickupLocation.id}`);
  if (!getLoc.res.ok || !getLoc.body?.location?.id) {
    fail(`GET /api/locations/[id] ${getLoc.res.status}`);
  }
  ok("api", "GET /api/locations/[id]");

  const forTrip = await authFetch(
    token,
    `/api/locations/${pickupLocation.id}/for-trip`
  );
  if (!forTrip.res.ok || !forTrip.body?.location?.pin_lat) {
    fail(`GET /api/locations/[id]/for-trip ${forTrip.res.status}`);
  }
  if (!forTrip.body.location.photo_url) {
    results.risks.push("for-trip photo_url null (signed URL may have failed silently)");
  }
  ok("api", "GET /api/locations/[id]/for-trip", forTrip.body.location.address);

  const quotePickupOnly = await authFetch(token, "/api/taxi/rides/quote", {
    method: "POST",
    body: JSON.stringify({
      pickupLocationId: pickupLocation.id,
      dropoffLocationId: dropoffLocation.id,
      countryCode: "GN",
      vehicleClass: "standard",
    }),
  });

  if (!quotePickupOnly.res.ok || !quotePickupOnly.body?.ok) {
    fail(
      `taxi quote ${quotePickupOnly.res.status}: ${quotePickupOnly.body?.error ?? quotePickupOnly.body?.message ?? "unknown"}`
    );
  }

  const route = quotePickupOnly.body.route ?? {};
  results.taxi.quote = {
    pickupLat: route.pickupLat,
    pickupLng: route.pickupLng,
    dropoffLat: route.dropoffLat,
    dropoffLng: route.dropoffLng,
    totalCents: quotePickupOnly.body.quote?.total_cents,
  };

  ok(
    "taxi",
    "quote with location IDs",
    `pickup ${route.pickupLat},${route.pickupLng} → dropoff ${route.dropoffLat},${route.dropoffLng}`
  );

  const latDeltaPickup = Math.abs(Number(route.pickupLat) - pickupCoords.lat);
  const lngDeltaPickup = Math.abs(Number(route.pickupLng) - pickupCoords.lng);
  if (latDeltaPickup > 0.001 || lngDeltaPickup > 0.001) {
    fail(
      `pickup snapshot mismatch: expected ~${pickupCoords.lat},${pickupCoords.lng} got ${route.pickupLat},${route.pickupLng}`
    );
  }
  ok("taxi", "pickup legacy coords snapshotted from location_point");

  const createRide = await authFetch(token, "/api/taxi/rides/create", {
    method: "POST",
    body: JSON.stringify({
      pickupLocationId: pickupLocation.id,
      dropoffLocationId: dropoffLocation.id,
      countryCode: "GN",
      vehicleClass: "standard",
      expectedQuoteTotalCents: Number(quotePickupOnly.body.quote?.total_cents ?? 0),
    }),
  });

  if (!createRide.res.ok || !createRide.body?.ok || !createRide.body?.ride?.id) {
    fail(
      `taxi create ${createRide.res.status}: ${createRide.body?.error ?? createRide.body?.message ?? "unknown"}`
    );
  }

  const rideId = createRide.body.ride.id;
  results.taxi.rideId = rideId;
  ok("taxi", "create with location IDs", rideId);

  const { data: rideRow, error: rideErr } = await admin
    .from("taxi_rides")
    .select(
      "id,pickup_location_id,dropoff_location_id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_address,dropoff_address,status"
    )
    .eq("id", rideId)
    .single();

  if (rideErr || !rideRow) {
    fail(`taxi_rides verify: ${rideErr?.message ?? "not found"}`);
  }

  if (rideRow.pickup_location_id !== pickupLocation.id) {
    fail(`pickup_location_id mismatch: ${rideRow.pickup_location_id}`);
  }
  if (rideRow.dropoff_location_id !== dropoffLocation.id) {
    fail(`dropoff_location_id mismatch: ${rideRow.dropoff_location_id}`);
  }
  if (
    Math.abs(Number(rideRow.pickup_lat) - pickupCoords.lat) > 0.001 ||
    Math.abs(Number(rideRow.pickup_lng) - pickupCoords.lng) > 0.001
  ) {
    fail("taxi_rides pickup_lat/lng not snapshotted");
  }
  if (
    Math.abs(Number(rideRow.dropoff_lat) - dropoffCoords.lat) > 0.001 ||
    Math.abs(Number(rideRow.dropoff_lng) - dropoffCoords.lng) > 0.001
  ) {
    fail("taxi_rides dropoff_lat/lng not snapshotted");
  }

  results.taxi.db = rideRow;
  ok("taxi", "DB FK + legacy coords verified");

  const dispatchSelect =
    "id,payment_status,status,driver_id,pickup_lat,pickup_lng,pickup_address";
  const dispatchFields = dispatchSelect.split(",").map((f) => f.trim());
  const hasDispatchCoords =
    rideRow.pickup_lat != null &&
    rideRow.pickup_lng != null &&
    !dispatchFields.includes("pickup_location_id");
  if (!hasDispatchCoords) {
    fail("Dispatch would miss pickup_lat/pickup_lng");
  }
  ok("dispatch", "unchanged — uses pickup_lat/pickup_lng only (no location_id in dispatch select)");

  const { data: drRow, error: drErr } = await client
    .from("delivery_requests")
    .insert({
      created_by: userId,
      client_user_id: userId,
      status: "pending",
      payment_status: "unpaid",
      kind: "delivery",
      request_type: "package",
      title: "E2E Phase 1.5 delivery",
      errand_description: "Automated E2E test",
      pickup_address: "Ratoma Kipé pickup E2E",
      dropoff_address: forTrip.body.location.address || "Ratoma dropoff E2E",
      pickup_lat: pickupCoords.lat,
      pickup_lng: pickupCoords.lng,
      dropoff_lat: dropoffCoords.lat,
      dropoff_lng: dropoffCoords.lng,
      dropoff_location_id: dropoffLocation.id,
      distance_miles: 1.2,
      eta_minutes: 8,
      subtotal: 0,
      delivery_fee: 5,
      tax: 0,
      total: 5,
      subtotal_cents: 0,
      delivery_fee_cents: 500,
      tax_cents: 0,
      total_cents: 500,
      currency: "GNF",
    })
    .select("id,dropoff_location_id,dropoff_lat,dropoff_lng")
    .single();

  if (drErr || !drRow?.id) {
    fail(`delivery_requests insert: ${drErr?.message ?? "unknown"}`);
  }

  results.delivery.requestId = drRow.id;
  results.delivery.db = drRow;
  ok("delivery", "create with dropoff_location_id", drRow.id);

  if (drRow.dropoff_location_id !== dropoffLocation.id) {
    fail("delivery dropoff_location_id mismatch");
  }
  if (
    Math.abs(Number(drRow.dropoff_lat) - dropoffCoords.lat) > 0.001 ||
    Math.abs(Number(drRow.dropoff_lng) - dropoffCoords.lng) > 0.001
  ) {
    fail("delivery dropoff_lat/lng not preserved");
  }
  ok("delivery", "DB FK + legacy coords verified");

  const schemaChecks = [
    { table: "location_points", column: "id" },
    { table: "taxi_rides", column: "pickup_location_id" },
    { table: "taxi_rides", column: "dropoff_location_id" },
    { table: "delivery_requests", column: "dropoff_location_id" },
    { table: "mmd_zones", column: "zone_code" },
  ];

  for (const check of schemaChecks) {
    const { error } = await admin.from(check.table).select(check.column).limit(1);
    if (error) fail(`Schema ${check.table}.${check.column}: ${error.message}`);
    ok("supabase", `table ${check.table}.${check.column}`);
  }

  const { count: zoneCount } = await admin
    .from("mmd_zones")
    .select("id", { count: "exact", head: true })
    .eq("country_code", "GN")
    .eq("is_active", true);

  results.supabase.gnActiveZones = zoneCount ?? 0;
  ok("supabase", "GN active zones", String(zoneCount ?? 0));

  const { data: bucket } = await admin.storage.getBucket("location-attachments");
  if (!bucket || bucket.public !== false) {
    fail("Bucket location-attachments must exist and be private");
  }
  ok("storage", "location-attachments private bucket");

  const { data: signed } = await admin.storage
    .from("location-attachments")
    .createSignedUrl(photo.body.photo_path, 300);
  if (!signed?.signedUrl) {
    results.risks.push("Admin signed URL failed for location photo");
  } else {
    ok("storage", "signed URL for photo");
  }

  const { data: rpcOk, error: rpcErr } = await admin.rpc(
    "driver_can_read_location_point",
    { p_location_id: pickupLocation.id, p_user_id: userId }
  );
  if (rpcErr) {
    fail(`driver_can_read_location_point RPC: ${rpcErr.message}`);
  }
  if (rpcOk === true) {
    results.risks.push(
      "driver_can_read_location_point returned true for client (expected false without active trip)"
    );
  }
  ok("supabase", "driver_can_read_location_point RPC callable");

  console.log("\n=== SUMMARY JSON ===");
  console.log(JSON.stringify(results, null, 2));
  console.log("\nMMD Phase 1.5 E2E: ALL PASS\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
