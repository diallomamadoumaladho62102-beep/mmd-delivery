import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        error: "invalid_json",
        message: "Requête invalide.",
      },
      400,
    );
  }

  const transportMode = String(body.transport_mode ?? body.transportMode ?? "")
    .trim()
    .toLowerCase();

  if (!transportMode) {
    return json(
      {
        ok: false,
        error: "transport_mode_required",
        message: "Mode de transport requis.",
      },
      400,
    );
  }

  const { data, error } = await auth.supabaseAdmin.rpc("change_driver_transport_mode", {
    p_user_id: auth.userId,
    p_transport_mode: transportMode,
  });

  if (error) {
    logTechnicalError("driver.transport-mode", error, { userId: auth.userId, transportMode });
    return json(
      {
        ok: false,
        error: "transport_mode_change_failed",
        message: toUserFacingError(error, "Impossible de changer le mode de transport pour le moment."),
      },
      500,
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === false) {
    return json(
      {
        ok: false,
        error: String(result.error ?? "transport_mode_change_failed"),
        message: toUserFacingError(result, "Impossible de changer le mode de transport pour le moment."),
      },
      400,
    );
  }

  return json({
    ok: true,
    transport_mode: result.transport_mode ?? transportMode,
    taxi_auto_disabled: result.taxi_auto_disabled === true,
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const [{ data: profile }, { data: hasMission }] = await Promise.all([
    auth.supabaseAdmin
      .from("driver_profiles")
      .select("transport_mode, vehicle_type, is_online")
      .eq("user_id", auth.userId)
      .maybeSingle(),
    auth.supabaseAdmin.rpc("driver_has_active_mission", { p_user_id: auth.userId }),
  ]);

  return json({
    ok: true,
    transport_mode: profile?.transport_mode ?? "bike",
    vehicle_type: profile?.vehicle_type ?? profile?.transport_mode ?? "bike",
    is_online: profile?.is_online === true,
    has_active_mission: hasMission === true,
  });
}
