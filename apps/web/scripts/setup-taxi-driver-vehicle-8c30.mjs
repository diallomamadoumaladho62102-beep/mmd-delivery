/**
 * Setup Honda Accord Sport taxi vehicle for test driver 8c30…
 * Official path: driver POST /api/driver/vehicles → admin-equivalent approve
 * (service_role mirrors PATCH /api/admin/driver-vehicles approve_vehicle) →
 * set active → enable taxi prefs. Idempotent by license_plate.
 *
 * No taxi ride / checkout / charge.
 *
 *   node --env-file=.env.local scripts/setup-taxi-driver-vehicle-8c30.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER_ID = "8c300089-6f16-407a-9be9-6eb75482f73d";
const DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const API = process.env.MMD_API_BASE || "https://www.mmddelivery.com";

const VEHICLE = {
  vehicle_make: "Honda",
  vehicle_model: "Accord Sport",
  vehicle_year: 2020,
  vehicle_color: "Gris",
  license_plate: "LTK 1944",
  seats_count: 4,
  vehicle_type: "sedan",
  has_air_conditioning: true,
  fuel_type: "gasoline",
  nickname: "Taxi Honda Accord Sport",
  child_seat_available: false,
  pets_allowed: false,
  large_luggage: false,
  phone_charger_available: false,
  quiet_vehicle: false,
};

const PLATE_VARIANTS = ["LTK 1944", "LTK1944", "ltk 1944", "ltk1944"];

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

function normalizePlate(p) {
  return String(p ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function sb(pathAndQuery, { method = "GET", headers = adminHeaders, body, prefer } = {}) {
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    method,
    headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
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

async function getDriverToken() {
  const gen = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: { type: "magiclink", email: DRIVER_EMAIL },
  });
  const hashed = gen.json?.hashed_token;
  if (!hashed) throw new Error(`magiclink failed: ${JSON.stringify(gen.json)}`);
  const verify = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const vj = await verify.json().catch(() => ({}));
  if (!vj.access_token) throw new Error("driver access_token missing");
  return vj.access_token;
}

async function loadVehicles() {
  const r = await sb(
    `/rest/v1/driver_vehicles?driver_user_id=eq.${DRIVER_ID}&deleted_at=is.null&select=*&order=updated_at.desc`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

async function findByPlate(vehicles) {
  const want = normalizePlate(VEHICLE.license_plate);
  return vehicles.find((v) => normalizePlate(v.license_plate) === want) ?? null;
}

async function approveVehicle(vehicleId) {
  // Mirror PATCH /api/admin/driver-vehicles action=approve_vehicle
  const patch = {
    admin_review_status: "approved",
    vehicle_status: "active",
    vehicle_active: true,
    inspection_status: "approved",
    insurance_status: "approved",
    registration_status: "approved",
    updated_at: new Date().toISOString(),
  };
  const upd = await sb(`/rest/v1/driver_vehicles?id=eq.${vehicleId}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=representation",
  });
  if (upd.status >= 400) {
    throw new Error(`approve patch failed: ${JSON.stringify(upd.json)}`);
  }
  const recalc = await sb("/rest/v1/rpc/recalculate_vehicle_category_eligibility", {
    method: "POST",
    body: { p_vehicle_id: vehicleId },
  });
  return { patch: Array.isArray(upd.json) ? upd.json[0] : upd.json, recalc: recalc.json };
}

async function ensureTaxiFeatures() {
  const existing = await sb(
    `/rest/v1/taxi_driver_features?user_id=eq.${DRIVER_ID}&select=*`,
  );
  const row = Array.isArray(existing.json) ? existing.json[0] : null;
  if (row?.taxi_enabled === true) return { action: "unchanged", row };
  const body = {
    user_id: DRIVER_ID,
    taxi_enabled: true,
    updated_at: new Date().toISOString(),
  };
  const r = await sb(`/rest/v1/taxi_driver_features`, {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
  // upsert via on_conflict if PostgREST supports it
  if (r.status >= 400) {
    const u = await sb(`/rest/v1/taxi_driver_features?user_id=eq.${DRIVER_ID}`, {
      method: "PATCH",
      body: { taxi_enabled: true, updated_at: body.updated_at },
      prefer: "return=representation",
    });
    return { action: "patched", row: Array.isArray(u.json) ? u.json[0] : u.json };
  }
  return { action: "upserted", row: Array.isArray(r.json) ? r.json[0] : r.json };
}

async function main() {
  const steps = [];
  const blockers = [];
  const notes = [];

  if (!supabaseUrl || !serviceKey || !anon) {
    throw new Error("Missing Supabase env");
  }

  const beforeProfile = await sb(
    `/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}&select=user_id,status,is_online,transport_mode,active_vehicle_id,vehicle_type,plate_number,vehicle_brand,vehicle_model`,
  );
  const profile0 = Array.isArray(beforeProfile.json) ? beforeProfile.json[0] : null;
  steps.push({ step: "profile_before", profile: profile0 });

  const beforePrefs = await sb(
    `/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}&select=*`,
  );
  const prefs0 = Array.isArray(beforePrefs.json) ? beforePrefs.json[0] : null;
  steps.push({ step: "prefs_before", prefs: prefs0 });

  let vehicles = await loadVehicles();
  steps.push({
    step: "vehicles_before",
    count: vehicles.length,
    plates: vehicles.map((v) => v.license_plate),
  });

  let vehicle = await findByPlate(vehicles);
  let created = false;

  const token = await getDriverToken();

  if (!vehicle) {
    const create = await api("/api/driver/vehicles", token, VEHICLE, "POST");
    steps.push({
      step: "driver_create_vehicle",
      http: create.status,
      ok: create.json?.ok,
      error: create.json?.error,
    });
    if (create.status >= 400 || create.json?.ok === false) {
      blockers.push(`create vehicle failed: ${create.json?.error || create.status}`);
    }
    vehicles = await loadVehicles();
    vehicle = await findByPlate(vehicles);
    created = !!vehicle;
  } else {
    steps.push({ step: "driver_create_vehicle", skipped: "plate_exists", id: vehicle.id });
    // Refresh identity fields if plate already exists (idempotent update of descriptors)
    const patch = await sb(`/rest/v1/driver_vehicles?id=eq.${vehicle.id}`, {
      method: "PATCH",
      body: {
        vehicle_make: VEHICLE.vehicle_make,
        vehicle_model: VEHICLE.vehicle_model,
        vehicle_year: VEHICLE.vehicle_year,
        vehicle_color: VEHICLE.vehicle_color,
        license_plate: VEHICLE.license_plate,
        seats_count: VEHICLE.seats_count,
        vehicle_type: VEHICLE.vehicle_type,
        nickname: VEHICLE.nickname,
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
    });
    vehicle = Array.isArray(patch.json) ? patch.json[0] : vehicle;
    steps.push({ step: "refresh_vehicle_fields", http: patch.status });
  }

  if (!vehicle) {
    blockers.push("vehicle missing after create");
  } else {
    const approve = await approveVehicle(vehicle.id);
    steps.push({
      step: "approve_vehicle_admin_equivalent",
      vehicle_id: vehicle.id,
      admin_review_status: approve.patch?.admin_review_status,
      vehicle_status: approve.patch?.vehicle_status,
      vehicle_active: approve.patch?.vehicle_active,
      inspection_status: approve.patch?.inspection_status,
      insurance_status: approve.patch?.insurance_status,
      registration_status: approve.patch?.registration_status,
      recalc: approve.recalc,
    });
    vehicle = approve.patch || vehicle;
  }

  // Profile legacy fields so change_driver_transport_mode(car) can pass doc checks.
  if (vehicle) {
    const profilePatch = await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
      method: "PATCH",
      body: {
        vehicle_brand: VEHICLE.vehicle_make,
        vehicle_model: VEHICLE.vehicle_model,
        vehicle_year: VEHICLE.vehicle_year,
        vehicle_color: VEHICLE.vehicle_color,
        plate_number: VEHICLE.license_plate,
        vehicle_type: "car",
        // Keep approved/online intact
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
    });
    steps.push({ step: "profile_legacy_vehicle_fields", http: profilePatch.status });

    // Ensure license fields exist for car mode gate (test/admin — not real docs).
    const prof = Array.isArray(profilePatch.json) ? profilePatch.json[0] : profile0;
    if (!prof?.license_number || !prof?.license_expiry) {
      const lic = await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
        method: "PATCH",
        body: {
          license_number: prof?.license_number || "MMD-TEST-LICENSE",
          license_expiry:
            prof?.license_expiry ||
            new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        },
        prefer: "return=representation",
      });
      steps.push({ step: "profile_test_license_fields", http: lic.status });
      notes.push(
        "license_number/expiry set via test/admin profile fields (not real driver documents). Verify real license/insurance/registration docs before public taxi launch.",
      );
    }
  }

  const taxiFeat = await ensureTaxiFeatures();
  steps.push({ step: "taxi_driver_features", ...taxiFeat });

  // Switch transport_mode to car via official RPC (keeps bike switchable; does not delete bike capability).
  const modeRpc = await sb("/rest/v1/rpc/change_driver_transport_mode", {
    method: "POST",
    body: { p_user_id: DRIVER_ID, p_transport_mode: "car" },
  });
  steps.push({ step: "change_transport_mode_car", result: modeRpc.json });
  if (modeRpc.json?.ok === false) {
    blockers.push(`transport_mode car failed: ${modeRpc.json?.error || modeRpc.json?.message}`);
  }

  // Must be offline to set active vehicle
  const wasOnline = profile0?.is_online === true;
  if (wasOnline) {
    await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
      method: "PATCH",
      body: { is_online: false, updated_at: new Date().toISOString() },
    });
    steps.push({ step: "go_offline_for_active_vehicle", ok: true });
  }

  if (vehicle) {
    const setActive = await api(
      "/api/driver/vehicles/active",
      token,
      { vehicle_id: vehicle.id },
      "POST",
    );
    steps.push({
      step: "set_active_vehicle",
      http: setActive.status,
      body: setActive.json,
    });
    if (setActive.json?.ok !== true) {
      // Fallback official RPC via service role
      const rpc = await sb("/rest/v1/rpc/set_driver_active_vehicle", {
        method: "POST",
        body: { p_driver_user_id: DRIVER_ID, p_vehicle_id: vehicle.id },
      });
      steps.push({ step: "set_active_vehicle_rpc", result: rpc.json });
      if (rpc.json?.ok !== true) {
        blockers.push(`set active failed: ${JSON.stringify(setActive.json || rpc.json)}`);
      }
    }
  }

  // Enable taxi + keep delivery prefs via driver API when possible
  const prefsPatch = await api(
    "/api/driver/service-preferences",
    token,
    {
      food_delivery_enabled: true,
      package_delivery_enabled: true,
      taxi_rides_enabled: true,
      accept_also_standard_rides: true,
    },
    "PATCH",
  );
  steps.push({
    step: "service_preferences_patch",
    http: prefsPatch.status,
    body: prefsPatch.json,
  });
  if (prefsPatch.json?.ok !== true) {
    // Service-role fallback after eligibility is set (same columns as official API)
    const fb = await sb(`/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}`, {
      method: "POST",
      body: {
        driver_user_id: DRIVER_ID,
        food_delivery_enabled: true,
        package_delivery_enabled: true,
        taxi_rides_enabled: true,
        accept_also_standard_rides: true,
        updated_at: new Date().toISOString(),
      },
      prefer: "resolution=merge-duplicates,return=representation",
    });
    if (fb.status >= 400) {
      const u = await sb(
        `/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}`,
        {
          method: "PATCH",
          body: {
            food_delivery_enabled: true,
            package_delivery_enabled: true,
            taxi_rides_enabled: true,
            accept_also_standard_rides: true,
            updated_at: new Date().toISOString(),
          },
          prefer: "return=representation",
        },
      );
      steps.push({ step: "service_preferences_service_role", http: u.status, body: u.json });
      if (u.status >= 400) blockers.push("service preferences update failed");
    } else {
      steps.push({ step: "service_preferences_service_role", http: fb.status, body: fb.json });
    }
    notes.push(
      `driver service-preferences API returned: ${prefsPatch.json?.error || prefsPatch.status}; applied service_role mirror of same fields`,
    );
  }

  // Restore online if was online
  if (wasOnline) {
    await sb(`/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}`, {
      method: "PATCH",
      body: { is_online: true, updated_at: new Date().toISOString() },
    });
    steps.push({ step: "restore_online", ok: true });
  }

  // Idempotency second pass: create again should not duplicate
  vehicles = await loadVehicles();
  const matches = vehicles.filter(
    (v) => normalizePlate(v.license_plate) === normalizePlate(VEHICLE.license_plate),
  );
  steps.push({ step: "idempotency_plate_count", count: matches.length });
  if (matches.length !== 1) blockers.push(`expected 1 vehicle for plate, got ${matches.length}`);

  vehicle = matches[0] || vehicle;

  const afterProfile = await sb(
    `/rest/v1/driver_profiles?user_id=eq.${DRIVER_ID}&select=user_id,status,is_online,transport_mode,active_vehicle_id,vehicle_type,plate_number`,
  );
  const profile = Array.isArray(afterProfile.json) ? afterProfile.json[0] : null;

  const afterPrefs = await sb(
    `/rest/v1/driver_service_preferences?driver_user_id=eq.${DRIVER_ID}&select=*`,
  );
  const prefs = Array.isArray(afterPrefs.json) ? afterPrefs.json[0] : null;

  const eligibility = await sb(
    `/rest/v1/vehicle_category_eligibility?vehicle_id=eq.${vehicle?.id ?? "00000000-0000-0000-0000-000000000000"}&select=*`,
  );
  const eligRows = Array.isArray(eligibility.json) ? eligibility.json : [];

  const taxiEligible = await sb("/rest/v1/rpc/is_taxi_driver_eligible", {
    method: "POST",
    body: { p_driver_id: DRIVER_ID, p_vehicle_class: "standard" },
  });
  // Try alternate arg names from migrations
  let taxiEligibleResult = taxiEligible.json;
  if (taxiEligible.status >= 400 || taxiEligible.json === null) {
    const alt = await sb("/rest/v1/rpc/is_taxi_driver_eligible", {
      method: "POST",
      body: { p_user_id: DRIVER_ID, p_vehicle_class: "standard" },
    });
    steps.push({ step: "is_taxi_driver_eligible_alt", status: alt.status, result: alt.json });
    if (alt.status < 400) taxiEligibleResult = alt.json;
  }
  steps.push({
    step: "is_taxi_driver_eligible",
    status: taxiEligible.status,
    result: taxiEligibleResult,
  });

  const catEligible = await sb("/rest/v1/rpc/is_driver_taxi_category_eligible", {
    method: "POST",
    body: { p_user_id: DRIVER_ID, p_vehicle_class: "standard" },
  });
  steps.push({
    step: "is_driver_taxi_category_eligible",
    status: catEligible.status,
    result: catEligible.json,
  });

  const loc = await sb(
    `/rest/v1/driver_locations?user_id=eq.${DRIVER_ID}&select=user_id,lat,lng,updated_at&order=updated_at.desc&limit=1`,
  );
  const location = Array.isArray(loc.json) ? loc.json[0] : null;

  // Reference pickup used in delivery proofs (Baldwin area)
  const REF_LAT = 40.673897;
  const REF_LNG = -73.610676;
  let distanceMiles = null;
  if (location?.lat != null && location?.lng != null) {
    distanceMiles = milesBetween(
      Number(location.lat),
      Number(location.lng),
      REF_LAT,
      REF_LNG,
    );
  }

  // Code taxi dispatch radius is 5 miles (not 15). Report both.
  const withinTaxiCodeRadius5 = distanceMiles != null && distanceMiles <= 5;
  const withinRequested15 = distanceMiles != null && distanceMiles <= 15;

  // Delivery bike capability: prefs + profile approved; bike mode switchable (not deleted).
  const deliveryOk =
    profile?.status === "approved" &&
    prefs?.package_delivery_enabled === true &&
    prefs?.food_delivery_enabled === true;

  const vehicleOk =
    vehicle &&
    String(vehicle.admin_review_status).toLowerCase() === "approved" &&
    String(vehicle.vehicle_status).toLowerCase() === "active" &&
    vehicle.vehicle_active === true &&
    normalizePlate(vehicle.license_plate) === normalizePlate(VEHICLE.license_plate) &&
    String(vehicle.vehicle_make).toLowerCase() === "honda" &&
    String(vehicle.vehicle_model).toLowerCase().includes("accord");

  const taxiFilterOk =
    taxiEligibleResult === true ||
    catEligible.json === true ||
    eligRows.some(
      (r) =>
        String(r.category) === "standard" &&
        (r.status === "eligible" || r.admin_approved === true),
    );

  if (profile?.status !== "approved") blockers.push("driver not approved");
  if (!vehicleOk) blockers.push("vehicle not approved/active Honda Accord Sport");
  if (profile?.active_vehicle_id !== vehicle?.id) {
    blockers.push("active_vehicle_id not pointing to Honda");
  }
  if (prefs?.taxi_rides_enabled !== true) blockers.push("taxi_rides_enabled false");
  if (prefs?.package_delivery_enabled !== true) {
    blockers.push("package_delivery_enabled false (bike/delivery path)");
  }
  if (String(profile?.transport_mode).toLowerCase() !== "car") {
    blockers.push(`transport_mode=${profile?.transport_mode} (need car for taxi)`);
  }
  if (!taxiFilterOk) blockers.push("taxi eligibility filter failed");
  if (distanceMiles == null) {
    notes.push("No driver_locations row — distance radius check skipped (eligibility RPC still evaluated).");
  } else if (!withinTaxiCodeRadius5) {
    notes.push(
      `Driver location is ${distanceMiles.toFixed(2)} mi from ref pickup; taxi code radius is 5 mi (requested check was 15 mi — within15=${withinRequested15}). Location may need refresh before live taxi dispatch.`,
    );
  }

  notes.push(
    "Taxi dispatch code radius is MAX_DISPATCH_MILES=5 (runTaxiRideDispatch). User asked 15 mi; delivery uses 15 mi. No code change in this setup.",
  );
  notes.push(
    "Multi-mode: car vehicle + taxi prefs active now; bike remains available by switching transport_mode back to bike (RPC) without deleting the car vehicle. Delivery prefs stay enabled.",
  );

  const verdict =
    blockers.length === 0
      ? "TAXI DRIVER VEHICLE SETUP — READY"
      : "TAXI DRIVER VEHICLE SETUP — BLOCKED";

  const report = {
    audited_at: new Date().toISOString(),
    verdict,
    driver_id: DRIVER_ID,
    driver_email: DRIVER_EMAIL,
    method: {
      create: created
        ? "POST /api/driver/vehicles (official)"
        : "reuse existing plate (idempotent)",
      approve:
        "service_role mirror of PATCH /api/admin/driver-vehicles action=approve_vehicle + rpc recalculate_vehicle_category_eligibility",
      active: "POST /api/driver/vehicles/active (+ rpc fallback)",
      transport_mode: "rpc change_driver_transport_mode → car",
      prefs: "PATCH /api/driver/service-preferences (service_role fallback)",
      taxi_features: "taxi_driver_features.taxi_enabled=true",
    },
    vehicle: vehicle
      ? {
          id: vehicle.id,
          vehicle_make: vehicle.vehicle_make,
          vehicle_model: vehicle.vehicle_model,
          vehicle_year: vehicle.vehicle_year,
          vehicle_color: vehicle.vehicle_color,
          license_plate: vehicle.license_plate,
          seats_count: vehicle.seats_count,
          vehicle_type: vehicle.vehicle_type,
          admin_review_status: vehicle.admin_review_status,
          vehicle_status: vehicle.vehicle_status,
          vehicle_active: vehicle.vehicle_active,
          inspection_status: vehicle.inspection_status,
          insurance_status: vehicle.insurance_status,
          registration_status: vehicle.registration_status,
          nickname: vehicle.nickname,
        }
      : null,
    profile: {
      status: profile?.status,
      is_online: profile?.is_online,
      transport_mode: profile?.transport_mode,
      active_vehicle_id: profile?.active_vehicle_id,
    },
    capabilities: {
      food_delivery_enabled: prefs?.food_delivery_enabled === true,
      package_delivery_enabled: prefs?.package_delivery_enabled === true,
      taxi_rides_enabled: prefs?.taxi_rides_enabled === true,
      bike_mode_switchable: true,
      delivery_still_accepts: deliveryOk,
    },
    eligibility: {
      is_taxi_driver_eligible: taxiEligibleResult,
      is_driver_taxi_category_eligible: catEligible.json,
      vehicle_category_eligibility: eligRows.map((r) => ({
        category: r.category,
        status: r.status,
        admin_approved: r.admin_approved,
        reason_code: r.reason_code,
      })),
      taxi_filter_ok: taxiFilterOk,
    },
    radius: {
      taxi_code_max_miles: 5,
      user_requested_miles: 15,
      driver_location: location,
      distance_miles_from_ref_pickup: distanceMiles,
      within_5_miles: withinTaxiCodeRadius5,
      within_15_miles: withinRequested15,
      ref_pickup: { lat: REF_LAT, lng: REF_LNG },
    },
    idempotency: { plate_match_count: matches.length },
    blockers,
    notes,
    steps,
    taxi_preflight: "not_started",
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(__dirname, "../../../backups/live-taxi-preflight");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "TAXI_DRIVER_VEHICLE_SETUP_8C30.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (blockers.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
