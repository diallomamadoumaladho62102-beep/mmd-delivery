import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";
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
  "wheelchair_equipment_verified",
  "admin_review_status",
  "admin_review_notes",
]);

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  // Prefer active_vehicle_id; fall back to newest non-deleted vehicle.
  const { data: profile } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("active_vehicle_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  let vehicle: Record<string, unknown> | null = null;
  const activeId = profile?.active_vehicle_id
    ? String(profile.active_vehicle_id)
    : null;

  if (activeId) {
    const { data, error } = await auth.supabaseAdmin
      .from("driver_vehicles")
      .select("*")
      .eq("id", activeId)
      .eq("driver_user_id", auth.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      logTechnicalError("driver.vehicle.get", error, { userId: auth.userId });
      return json(
        {
          ok: false,
          error: "vehicle_load_failed",
          message: toUserFacingError(error, "Impossible de charger le véhicule pour le moment."),
        },
        500,
      );
    }
    vehicle = (data as Record<string, unknown> | null) ?? null;
  }

  if (!vehicle) {
    const { data, error: vehicleError } = await auth.supabaseAdmin
      .from("driver_vehicles")
      .select("*")
      .eq("driver_user_id", auth.userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (vehicleError) {
      logTechnicalError("driver.vehicle.get", vehicleError, { userId: auth.userId });
      return json(
        {
          ok: false,
          error: "vehicle_load_failed",
          message: toUserFacingError(vehicleError, "Impossible de charger le véhicule pour le moment."),
        },
        500,
      );
    }
    vehicle = (data as Record<string, unknown> | null) ?? null;
  }

  const { data: eligibility, error: eligibilityError } = await auth.supabaseAdmin
    .from("vehicle_category_eligibility")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .order("category");

  if (eligibilityError) {
    logTechnicalError("driver.vehicle.eligibility", eligibilityError, { userId: auth.userId });
    return json(
      {
        ok: false,
        error: "eligibility_load_failed",
        message: toUserFacingError(eligibilityError, "Impossible de charger l'éligibilité pour le moment."),
      },
      500,
    );
  }

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
    if (error) {
      logTechnicalError("driver.vehicle.update", error, { userId: auth.userId, vehicleId });
      return json(
        {
          ok: false,
          error: "vehicle_update_failed",
          message: toUserFacingError(error, "Impossible d'enregistrer le véhicule pour le moment."),
        },
        500,
      );
    }
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
    if (error) {
      logTechnicalError("driver.vehicle.update", error, { userId: auth.userId, vehicleId });
      return json(
        {
          ok: false,
          error: "vehicle_update_failed",
          message: toUserFacingError(error, "Impossible d'enregistrer le véhicule pour le moment."),
        },
        500,
      );
    }
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

  if (error) {
    logTechnicalError("driver.vehicle.review", error, { userId: auth.userId });
    return json(
      {
        ok: false,
        error: "vehicle_review_failed",
        message: toUserFacingError(error, "Impossible d'envoyer la demande pour le moment."),
      },
      500,
    );
  }

  await auth.supabaseAdmin.rpc("recalculate_vehicle_category_eligibility", {
    p_vehicle_id: vehicle.id,
  });

  return json({ ok: true, message: "Demande de revue envoyée à l'équipe MMD." });
}
