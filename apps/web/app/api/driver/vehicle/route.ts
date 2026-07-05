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
]);

const DRIVER_FORBIDDEN_FIELDS = new Set([
  "admin_approved",
  "admin_suspended",
  "status",
  "inspection_status",
  "insurance_status",
  "registration_status",
  "vehicle_active",
  "wheelchair_equipment_verified",
  "admin_review_status",
  "admin_review_notes",
]);

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data: vehicle, error: vehicleError } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (vehicleError) return json({ ok: false, error: vehicleError.message }, 500);

  const { data: eligibility, error: eligibilityError } = await auth.supabaseAdmin
    .from("vehicle_category_eligibility")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .order("category");

  if (eligibilityError) return json({ ok: false, error: eligibilityError.message }, 500);

  const categories = (eligibility ?? []).map((row) => ({
    category: row.category,
    label: TAXI_CATEGORY_LABELS[row.category as TaxiCategory] ?? row.category,
    status: row.status,
    reason_code: row.reason_code,
    reason_message: row.reason_message,
    admin_approved: row.admin_approved,
    admin_suspended: row.admin_suspended,
  }));

  return json({
    ok: true,
    vehicle: vehicle ?? null,
    categories,
    eligible_categories: categories
      .filter((c) => c.status === "eligible")
      .map((c) => c.category),
  });
}

export async function PATCH(req: NextRequest) {
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
    is_primary: true,
    updated_at: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(body)) {
    if (DRIVER_FORBIDDEN_FIELDS.has(key)) {
      return json({ ok: false, error: "forbidden_field", field: key }, 403);
    }
    if (DRIVER_WRITABLE_FIELDS.has(key)) {
      patch[key] = value;
    }
  }

  const { data: existing } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("id")
    .eq("driver_user_id", auth.userId)
    .eq("is_primary", true)
    .maybeSingle();

  let vehicleId = existing?.id as string | undefined;

  if (vehicleId) {
    const { error } = await auth.supabaseAdmin
      .from("driver_vehicles")
      .update(patch)
      .eq("id", vehicleId);
    if (error) return json({ ok: false, error: error.message }, 500);
  } else {
    const { data, error } = await auth.supabaseAdmin
      .from("driver_vehicles")
      .insert({
        ...patch,
        vehicle_active: true,
        admin_review_status: "pending_review",
      })
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);
    vehicleId = data.id;
  }

  if (vehicleId) {
    await auth.supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
      p_vehicle_id: vehicleId,
    });
  }

  return GET(req);
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data: vehicle } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .select("id")
    .eq("driver_user_id", auth.userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (!vehicle?.id) {
    return json({ ok: false, error: "no_vehicle", message: "Enregistrez d'abord votre véhicule." }, 400);
  }

  const { error } = await auth.supabaseAdmin
    .from("driver_vehicles")
    .update({
      review_requested_at: new Date().toISOString(),
      admin_review_status: "pending_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehicle.id);

  if (error) return json({ ok: false, error: error.message }, 500);

  await auth.supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
    p_vehicle_id: vehicle.id,
  });

  return json({ ok: true, message: "Demande de revue envoyée à l'équipe MMD." });
}
