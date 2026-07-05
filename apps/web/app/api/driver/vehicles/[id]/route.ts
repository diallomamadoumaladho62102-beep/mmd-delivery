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
  "driver_user_id",
]);

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { id: vehicleId } = await context.params;
  if (!vehicleId) return json({ ok: false, error: "vehicle_id_required" }, 400);

  const { data: existing, error: existingError } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("driver_user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) return json({ ok: false, error: existingError.message }, 500);
  if (!existing) return json({ ok: false, error: "vehicle_not_found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(body)) {
    if (DRIVER_FORBIDDEN_FIELDS.has(key)) {
      return json({ ok: false, error: "forbidden_field", field: key }, 403);
    }
    if (DRIVER_WRITABLE_FIELDS.has(key)) {
      patch[key] = value;
    }
  }

  const { error } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .update(patch)
    .eq("id", vehicleId);

  if (error) return json({ ok: false, error: error.message }, 500);

  await auth.supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
    p_vehicle_id: vehicleId,
  });

  return json({ ok: true, vehicle_id: vehicleId });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { id: vehicleId } = await context.params;

  const { data: profile } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("active_vehicle_id,is_online")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (profile?.is_online) {
    return json({ ok: false, error: "must_be_offline", message: "Passez hors ligne pour supprimer un véhicule." }, 400);
  }

  if (String(profile?.active_vehicle_id ?? "") === vehicleId) {
    return json({ ok: false, error: "active_vehicle", message: "Changez de véhicule actif avant suppression." }, 400);
  }

  const { data: activeRide } = await auth.supabaseAdmin
    .from("taxi_rides")
    .select("id")
    .eq("driver_id", auth.userId)
    .in("status", ["accepted", "driver_arrived", "in_progress", "dispatching"])
    .limit(1);

  if ((activeRide ?? []).length > 0) {
    return json({ ok: false, error: "active_ride_in_progress" }, 400);
  }

  const { error } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .update({
      deleted_at: new Date().toISOString(),
      vehicle_active: false,
      vehicle_status: "inactive",
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicleId)
    .eq("driver_user_id", auth.userId);

  if (error) return json({ ok: false, error: error.message }, 500);

  await auth.supabaseAdmin.rpc("log_driver_vehicle_history", {
    p_driver_user_id: auth.userId,
    p_vehicle_id: vehicleId,
    p_action: "vehicle_deleted",
    p_actor_user_id: auth.userId,
    p_metadata: {},
  });

  return json({ ok: true });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { id: vehicleId } = await context.params;

  const { data: vehicle, error } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("driver_user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!vehicle) return json({ ok: false, error: "vehicle_not_found" }, 404);

  const { data: eligibility } = await auth.supabaseAdmin
    .from("vehicle_category_eligibility")
    .select("*")
    .eq("vehicle_id", vehicleId);

  const categories = (eligibility ?? []).map((row) => ({
    category: row.category,
    label: TAXI_CATEGORY_LABELS[row.category as TaxiCategory] ?? row.category,
    status: row.status,
    reason_code: row.reason_code,
    reason_message: row.reason_message,
  }));

  return json({ ok: true, vehicle, categories });
}
