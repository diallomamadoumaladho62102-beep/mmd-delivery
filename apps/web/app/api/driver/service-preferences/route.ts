import { NextRequest } from "next/server";
import {
  DEFAULT_DRIVER_SERVICE_PREFERENCES,
  type DriverServicePreferences,
} from "@/lib/driverServicePreferencesTypes";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { hasAnyServiceEnabled } from "@/lib/vehicleCategoryEligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function extractPreferences(row: Record<string, unknown> | null, userId: string): DriverServicePreferences {
  return {
    driver_user_id: userId,
    food_delivery_enabled: Boolean(
      row?.food_delivery_enabled ?? DEFAULT_DRIVER_SERVICE_PREFERENCES.food_delivery_enabled,
    ),
    package_delivery_enabled: Boolean(
      row?.package_delivery_enabled ?? DEFAULT_DRIVER_SERVICE_PREFERENCES.package_delivery_enabled,
    ),
    taxi_rides_enabled: Boolean(
      row?.taxi_rides_enabled ?? DEFAULT_DRIVER_SERVICE_PREFERENCES.taxi_rides_enabled,
    ),
    accept_also_standard_rides: Boolean(
      row?.accept_also_standard_rides ??
        DEFAULT_DRIVER_SERVICE_PREFERENCES.accept_also_standard_rides,
    ),
    updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from("driver_service_preferences")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .maybeSingle();

  if (error) return json({ ok: false, error: error.message }, 500);

  const preferences = extractPreferences(data as Record<string, unknown> | null, auth.userId);

  return json({
    ok: true,
    preferences,
    has_any_enabled: hasAnyServiceEnabled(preferences),
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

  const allowedKeys = new Set([
    "food_delivery_enabled",
    "package_delivery_enabled",
    "taxi_rides_enabled",
    "accept_also_standard_rides",
  ]);
  const extraKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) {
    return json({ ok: false, error: "forbidden_field", fields: extraKeys }, 403);
  }

  const { data: existing } = await auth.supabaseAdmin
    .from("driver_service_preferences")
    .select("*")
    .eq("driver_user_id", auth.userId)
    .maybeSingle();

  const current = extractPreferences(existing as Record<string, unknown> | null, auth.userId);

  const next: DriverServicePreferences = {
    driver_user_id: auth.userId,
    food_delivery_enabled:
      body.food_delivery_enabled !== undefined
        ? Boolean(body.food_delivery_enabled)
        : current.food_delivery_enabled,
    package_delivery_enabled:
      body.package_delivery_enabled !== undefined
        ? Boolean(body.package_delivery_enabled)
        : current.package_delivery_enabled,
    taxi_rides_enabled:
      body.taxi_rides_enabled !== undefined
        ? Boolean(body.taxi_rides_enabled)
        : current.taxi_rides_enabled,
    accept_also_standard_rides:
      body.accept_also_standard_rides !== undefined
        ? Boolean(body.accept_also_standard_rides)
        : current.accept_also_standard_rides,
  };

  if (!hasAnyServiceEnabled(next)) {
    return json(
      {
        ok: false,
        error: "no_service_enabled",
        message: "Activez au moins un service (Food, Colis ou Taxi).",
      },
      400,
    );
  }

  if (next.taxi_rides_enabled) {
    const { data: eligible } = await auth.supabaseAdmin.rpc(
      "is_driver_taxi_category_eligible",
      { p_user_id: auth.userId, p_vehicle_class: "standard" },
    );

    const { data: taxiFeatures } = await auth.supabaseAdmin
      .from("taxi_driver_features")
      .select("taxi_enabled")
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (!taxiFeatures?.taxi_enabled) {
      return json(
        {
          ok: false,
          error: "taxi_not_activated",
          message: "Le service taxi n'est pas encore activé pour votre compte.",
        },
        400,
      );
    }

    if (eligible !== true) {
      return json(
        {
          ok: false,
          error: "taxi_vehicle_not_eligible",
          message:
            "Votre véhicule n'est pas admissible au taxi. Consultez Mon véhicule ou demandez une revue admin.",
        },
        400,
      );
    }
  }

  const { data, error } = await auth.supabaseAdmin
    .from("driver_service_preferences")
    .upsert(
      {
        ...next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "driver_user_id" },
    )
    .select("*")
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  const { data: profile } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("is_online")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (profile?.is_online && !hasAnyServiceEnabled(next)) {
    await auth.supabaseAdmin
      .from("driver_profiles")
      .update({ is_online: false, updated_at: new Date().toISOString() })
      .eq("user_id", auth.userId);
  }

  return json({
    ok: true,
    preferences: extractPreferences(data as Record<string, unknown>, auth.userId),
  });
}
