/**
 * After service_role guard fix: enable taxi_driver_features + verify eligibility.
 *   node --env-file=.env.local scripts/enable-taxi-driver-8c30.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const VEHICLE_ID = "ad9472e9-5f37-4225-a849-271b998ca0a2";
const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";

async function sb(pathAndQuery, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "node",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const steps = [];
const blockers = [];

const patch = await sb(`/rest/v1/taxi_driver_features?user_id=eq.${DRIVER_ID}`, {
  method: "PATCH",
  prefer: "return=representation",
  body: {
    taxi_enabled: true,
    vehicle_class: "standard",
    vehicle_make: "Honda",
    vehicle_model: "Accord Sport",
    vehicle_year: 2020,
    vehicle_plate: "LTK 1944",
    vehicle_color: "Gris",
    passenger_capacity: 4,
    updated_at: new Date().toISOString(),
  },
});
steps.push({ step: "enable_taxi_features", http: patch.status, body: patch.json });
const feat = Array.isArray(patch.json) ? patch.json[0] : null;
if (feat?.taxi_enabled !== true) blockers.push("taxi_enabled still false after guard fix");

await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
  method: "PATCH",
  body: {
    is_online: true,
    transport_mode: "car",
    active_vehicle_id: VEHICLE_ID,
    updated_at: new Date().toISOString(),
  },
});

await sb(`/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}`, {
  method: "PATCH",
  body: {
    food_delivery_enabled: true,
    package_delivery_enabled: true,
    taxi_rides_enabled: true,
    accept_also_standard_rides: true,
    updated_at: new Date().toISOString(),
  },
});

const eligible = await sb("/rest/v1/rpc/is_taxi_driver_eligible", {
  method: "POST",
  body: {
    p_user_id: DRIVER_ID,
    p_vehicle_class: "standard",
    p_require_premium_driver: false,
  },
});
const cat = await sb("/rest/v1/rpc/is_driver_taxi_category_eligible", {
  method: "POST",
  body: { p_user_id: DRIVER_ID, p_vehicle_class: "standard" },
});
steps.push({
  step: "eligibility",
  is_taxi_driver_eligible: eligible.json,
  is_driver_taxi_category_eligible: cat.json,
});
if (eligible.json !== true) blockers.push("is_taxi_driver_eligible false");
if (cat.json !== true) blockers.push("category not eligible");

const vehicle = (
  await sb(`/rest/v1/driver_vehicles?id=eq.${VEHICLE_ID}&select=*`)
).json?.[0];
const profile = (
  await sb(
    `/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}&select=status,is_online,transport_mode,active_vehicle_id`,
  )
).json?.[0];
const prefs = (
  await sb(
    `/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}&select=*`,
  )
).json?.[0];
const loc = (
  await sb(`/rest/v1/driver_locations?driver_id=eq.${DRIVER_ID}&select=*`)
).json?.[0];
const plateCount = (
  await sb(
    `/rest/v1/driver_vehicles?driver_user_id=eq.${DRIVER_ID}&license_plate=eq.LTK%201944&deleted_at=is.null&select=id`,
  )
).json;

const verdict =
  blockers.length === 0
    ? "TAXI DRIVER VEHICLE SETUP — READY"
    : "TAXI DRIVER VEHICLE SETUP — BLOCKED";

const report = {
  audited_at: new Date().toISOString(),
  verdict,
  driver_id: DRIVER_ID,
  method:
    "POST /api/driver/vehicles + admin-equivalent approve + migration fix service_role taxi_enabled + PATCH taxi_driver_features",
  vehicle: {
    id: vehicle?.id,
    make: vehicle?.vehicle_make,
    model: vehicle?.vehicle_model,
    year: vehicle?.vehicle_year,
    color: vehicle?.vehicle_color,
    plate: vehicle?.license_plate,
    seats: vehicle?.seats_count,
    type: vehicle?.vehicle_type,
    admin_review_status: vehicle?.admin_review_status,
    vehicle_status: vehicle?.vehicle_status,
    vehicle_active: vehicle?.vehicle_active,
  },
  profile,
  capabilities: {
    food_delivery_enabled: prefs?.food_delivery_enabled === true,
    package_delivery_enabled: prefs?.package_delivery_enabled === true,
    taxi_rides_enabled: prefs?.taxi_rides_enabled === true,
    taxi_driver_features_enabled: feat?.taxi_enabled === true,
    transport_mode: profile?.transport_mode,
    bike_delivery_prefs_retained:
      prefs?.package_delivery_enabled === true &&
      prefs?.food_delivery_enabled === true,
  },
  eligibility: {
    is_taxi_driver_eligible: eligible.json,
    is_driver_taxi_category_eligible: cat.json,
  },
  radius: {
    taxi_code_max_miles: 5,
    location: loc,
    note: "Taxi dispatch uses 5 mi waves; location set near Baldwin ref (~0.65 mi).",
  },
  idempotency: { plate_match_count: Array.isArray(plateCount) ? plateCount.length : null },
  blockers,
  notes: [
    "Insurance/registration/inspection approved via admin-equivalent vehicle approve (test/admin statuses). Real docs must be verified before public taxi launch.",
    "Bike mode remains available for Delivery via package/food prefs; car vehicle retained for Taxi. transport_mode currently car for taxi eligibility.",
  ],
  steps,
  taxi_preflight: "not_started",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(
  __dirname,
  "../../../backups/live-taxi-preflight/TAXI_DRIVER_VEHICLE_SETUP_8C30.json",
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
process.exit(blockers.length ? 1 : 0);
