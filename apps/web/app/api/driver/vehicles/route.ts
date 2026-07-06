import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import {
  TAXI_CATEGORY_LABELS,
  type TaxiCategory,
} from "@/lib/driverServicePreferencesTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const DRIVER_WRITABLE_FIELDS = new Set([
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "vehicle_color",
  "license_plate",
  "seats_count",
  "vehicle_type",
  "has_air_conditioning",
  "wheelchair_accessible",
  "child_seat_available",
  "luggage_capacity",
  "fuel_type",
  "nickname",
  "pets_allowed",
  "large_luggage",
  "phone_charger_available",
  "quiet_vehicle",
]);

const DRIVER_FORBIDDEN_FIELDS = new Set([
  "admin_approved",
  "admin_suspended",
  "status",
  "inspection_status",
  "insurance_status",
  "registration_status",
  "vehicle_active",
  "vehicle_status",
  "wheelchair_equipment_verified",
  "admin_review_status",
  "admin_review_notes",
  "is_primary",
  "deleted_at",
]);

function mapVehicleCategories(
  eligibility: Array<Record<string, unknown>> | null | undefined,
  vehicleId: string,
) {
  return (eligibility ?? [])
    .filter((row) => String(row.vehicle_id) === vehicleId)
    .map((row) => ({
      category: row.category,
      label: TAXI_CATEGORY_LABELS[row.category as TaxiCategory] ?? row.category,
      status: row.status,
      reason_code: row.reason_code,
      reason_message: row.reason_message,
      admin_approved: row.admin_approved,
      admin_suspended: row.admin_suspended,
    }));
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data: profile } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("active_vehicle_id,is_online")
    .eq("user_id", auth.userId)
    .maybeSingle();

  const { data: vehicles, error: vehicleError } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (vehicleError) return json({ ok: false, error: vehicleError.message }, 500);

  const { data: eligibility, error: eligibilityError } = await auth.supabaseAdmin
    .from("vehicle_category_eligibility")
    .select("*")
    .eq("driver_user_id", auth.userId);

  if (eligibilityError) return json({ ok: false, error: eligibilityError.message }, 500);

  const { data: history } = await auth.supabaseAdmin
    .from("driver_vehicle_history")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const items = (vehicles ?? []).map((vehicle) => {
    const categories = mapVehicleCategories(eligibility as Array<Record<string, unknown>>, String(vehicle.id));
    return {
      ...vehicle,
      categories,
      eligible_categories: categories.filter((c) => c.status === "eligible").map((c) => c.category),
      is_active: String(profile?.active_vehicle_id ?? "") === String(vehicle.id),
    };
  });

  return json({
    ok: true,
    vehicles: items,
    active_vehicle_id: profile?.active_vehicle_id ?? null,
    is_online: profile?.is_online === true,
    history: history ?? [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const patch: Record<string, unknown> = {
    driver_user_id: auth.userId,
    updated_at: new Date().toISOString(),
    vehicle_status: "pending_review",
    admin_review_status: "pending_review",
    vehicle_active: true,
    is_primary: false,
  };

  for (const [key, value] of Object.entries(body)) {
    if (DRIVER_FORBIDDEN_FIELDS.has(key)) {
      return json({ ok: false, error: "forbidden_field", field: key }, 403);
    }
    if (DRIVER_WRITABLE_FIELDS.has(key)) {
      patch[key] = value;
    }
  }

  const { data, error } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .insert(patch)
    .select("*")
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  await auth.supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
    p_vehicle_id: data.id,
  });

  await auth.supabaseAdmin.rpc("log_driver_vehicle_history", {
    p_driver_user_id: auth.userId,
    p_vehicle_id: data.id,
    p_action: "vehicle_added",
    p_actor_user_id: auth.userId,
    p_metadata: { license_plate: data.license_plate },
  });

  return GET(req);
}
