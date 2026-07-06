import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const VEHICLE_FIELDS = new Set([
  "child_seat_available",
  "pets_allowed",
  "large_luggage",
  "phone_charger_available",
  "quiet_vehicle",
  "has_air_conditioning",
]);

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data: profile } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("non_smoking, active_vehicle_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  let vehicle = null;
  if (profile?.active_vehicle_id) {
    const { data } = await auth.supabaseAdmin
      .from("driver_vehicles")
      .select(
        "id,child_seat_available,pets_allowed,large_luggage,phone_charger_available,quiet_vehicle,has_air_conditioning,fuel_type",
      )
      .eq("id", profile.active_vehicle_id)
      .maybeSingle();
    vehicle = data;
  }

  return json({
    ok: true,
    non_smoking: profile?.non_smoking === true,
    vehicle,
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

  if (body.non_smoking !== undefined) {
    await auth.supabaseAdmin
      .from("driver_profiles")
      .update({ non_smoking: Boolean(body.non_smoking), updated_at: new Date().toISOString() })
      .eq("user_id", auth.userId);
  }

  const vehiclePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of VEHICLE_FIELDS) {
    if (body[key] !== undefined) {
      vehiclePatch[key] = Boolean(body[key]);
    }
  }

  if (Object.keys(vehiclePatch).length > 1) {
    const { data: profile } = await auth.supabaseAdmin
      .from("driver_profiles")
      .select("active_vehicle_id")
      .eq("user_id", auth.userId)
      .maybeSingle();

    const vehicleId = profile?.active_vehicle_id;
    if (!vehicleId) {
      return json({ ok: false, error: "no_active_vehicle" }, 400);
    }

    await auth.supabaseAdmin
      .from("driver_vehicles")
      .update(vehiclePatch)
      .eq("id", vehicleId)
      .eq("driver_user_id", auth.userId);
  }

  return GET(req);
}
