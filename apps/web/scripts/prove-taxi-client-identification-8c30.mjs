/**
 * Prove taxi client identification for driver 8c30 / Honda LTK 1944.
 * No taxi ride / checkout / payment.
 *
 *   node --env-file=.env.local scripts/prove-taxi-client-identification-8c30.mjs
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

async function sb(pathAndQuery) {
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      "User-Agent": "node",
    },
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function formatTaxiVehicleLabel({ make, model, color }) {
  const parts = [make, model].map((x) => String(x ?? "").trim()).filter(Boolean);
  const c = String(color ?? "").trim();
  if (!parts.length) return c || null;
  return c ? `${parts.join(" ")} ${c.toLowerCase()}` : parts.join(" ");
}

const blockers = [];
const notes = [];

const vehicle = (
  await sb(
    `/rest/v1/driver_vehicles?id=eq.${VEHICLE_ID}&select=id,driver_user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,vehicle_type,vehicle_active,admin_review_status,vehicle_status,deleted_at`,
  )
).json?.[0];

const profile = (
  await sb(`/rest/v1/profiles?id=eq.${DRIVER_ID}&select=full_name,avatar_url`)
).json?.[0];

const driverProfile = (
  await sb(
    `/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}&select=full_name,photo_url,rating,rating_count,total_deliveries,active_vehicle_id,transport_mode,status,is_online`,
  )
).json?.[0];

const taxiFeatures = (
  await sb(
    `/rest/v1/taxi_driver_features?user_id=eq.${DRIVER_ID}&select=taxi_enabled,rating_taxi`,
  )
).json?.[0];

const cols = await sb(
  `/rest/v1/taxi_rides?select=driver_display_name,vehicle_plate_snapshot&limit=1`,
);
const snapshotColumnsReady = cols.status === 200;

if (!vehicle) blockers.push("Honda vehicle missing");
if (
  String(vehicle?.license_plate ?? "")
    .toUpperCase()
    .replace(/\s+/g, "") !== "LTK1944"
) {
  blockers.push("plate mismatch");
}
if (driverProfile?.active_vehicle_id !== VEHICLE_ID) {
  blockers.push("active_vehicle_id not Honda");
}
if (taxiFeatures?.taxi_enabled !== true) blockers.push("taxi_enabled false");
if (!snapshotColumnsReady) {
  blockers.push("snapshot columns missing on taxi_rides (migration not applied)");
}

const label = formatTaxiVehicleLabel({
  make: vehicle?.vehicle_make,
  model: vehicle?.vehicle_model,
  color: vehicle?.vehicle_color,
});

const apiAfterAccept = {
  driver_name: profile?.full_name || driverProfile?.full_name || null,
  driver_photo: driverProfile?.photo_url || profile?.avatar_url || null,
  driver_rating: driverProfile?.rating ?? taxiFeatures?.rating_taxi ?? null,
  driver_trips_count: driverProfile?.total_deliveries ?? driverProfile?.rating_count ?? null,
  vehicle_make: vehicle?.vehicle_make ?? null,
  vehicle_model: vehicle?.vehicle_model ?? null,
  vehicle_year: vehicle?.vehicle_year ?? null,
  vehicle_color: vehicle?.vehicle_color ?? null,
  vehicle_plate: vehicle?.license_plate ?? null,
  vehicle_photo: null,
  vehicle_label: label,
};

const apiBeforeAssign = {
  driver_name: null,
  vehicle_plate: null,
};

if (apiAfterAccept.vehicle_plate !== "LTK 1944") blockers.push("API plate != LTK 1944");
if (apiAfterAccept.vehicle_label !== "Honda Accord Sport gris") {
  blockers.push(`API label wrong: ${apiAfterAccept.vehicle_label}`);
}
if (String(vehicle?.vehicle_type ?? "").toLowerCase() === "bike") {
  blockers.push("bike vehicle would be shown");
}

notes.push(
  "Client screen: TaxiRideTrackingScreen — large plate, Honda Accord Sport gris, Call (masked), Message, Share; map+ETA already present.",
);
notes.push("Shared RN screen covers Android + iOS; no build/OTA in this step.");
notes.push(
  "No taxi safety PIN today; safety recording remains. No personal phone in payload.",
);
notes.push("vehicle_photo unavailable until a vehicle photo upload column/flow exists.");

const verdict =
  blockers.length === 0
    ? "TAXI CLIENT DRIVER IDENTIFICATION — READY"
    : "TAXI CLIENT DRIVER IDENTIFICATION — BLOCKED";

const report = {
  audited_at: new Date().toISOString(),
  verdict,
  driver_id: DRIVER_ID,
  vehicle_linked: {
    id: vehicle?.id,
    make: vehicle?.vehicle_make,
    model: vehicle?.vehicle_model,
    year: vehicle?.vehicle_year,
    color: vehicle?.vehicle_color,
    plate: vehicle?.license_plate,
    type: vehicle?.vehicle_type,
    active: vehicle?.vehicle_active,
    admin_review_status: vehicle?.admin_review_status,
    vehicle_status: vehicle?.vehicle_status,
  },
  api_payload_after_accept_simulation: apiAfterAccept,
  api_payload_before_assign: apiBeforeAssign,
  client_screen: "apps/mobile/src/screens/taxi/TaxiRideTrackingScreen.tsx",
  history_screen: "apps/mobile/src/screens/taxi/TaxiHistoryScreen.tsx",
  map_and_eta: "LiveTripMap + LiveEtaBanner",
  plate_visible: "fontSize 28 / fontWeight 900 — Plaque LTK 1944",
  snapshot_columns_ready: snapshotColumnsReady,
  profile: {
    status: driverProfile?.status,
    is_online: driverProfile?.is_online,
    transport_mode: driverProfile?.transport_mode,
    active_vehicle_id: driverProfile?.active_vehicle_id,
  },
  blockers,
  notes,
  taxi_payment: "not_started",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(
  __dirname,
  "../../../backups/live-taxi-preflight/TAXI_CLIENT_DRIVER_IDENTIFICATION.json",
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
process.exit(blockers.length ? 1 : 0);
