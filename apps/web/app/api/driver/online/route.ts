import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { setDriverOnlineStatusAdmin } from "@/lib/driverOnlineStatus";
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
    return json({ ok: false, error: "invalid_json", message: "Requête invalide." }, 400);
  }

  const nextOnline = body.is_online === true || body.isOnline === true;
  const goingOffline = body.is_online === false || body.isOnline === false;

  if (!nextOnline && !goingOffline) {
    return json(
      {
        ok: false,
        error: "is_online_required",
        message: "Indiquez si vous souhaitez passer en ligne ou hors ligne.",
      },
      400,
    );
  }

  try {
    const result = await setDriverOnlineStatusAdmin(
      auth.supabaseAdmin,
      auth.userId,
      nextOnline,
    );

    if (result.ok === false) {
      return json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        result.error === "not_authenticated" ? 401 : 400,
      );
    }

    return json({ ok: true, is_online: result.is_online === true });
  } catch (error) {
    logTechnicalError("driver.online", error, { userId: auth.userId, nextOnline });
    return json(
      {
        ok: false,
        error: "online_status_update_failed",
        message: toUserFacingError(
          error,
          "Impossible de changer le statut pour le moment.",
        ),
      },
      500,
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from("driver_profiles")
    .select("is_online, status, transport_mode, active_vehicle_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error) {
    logTechnicalError("driver.online.get", error, { userId: auth.userId });
    return json(
      {
        ok: false,
        error: "online_status_load_failed",
        message: toUserFacingError(
          error,
          "Impossible de charger votre statut pour le moment.",
        ),
      },
      500,
    );
  }

  return json({
    ok: true,
    is_online: data?.is_online === true,
    status: data?.status ?? null,
    transport_mode: data?.transport_mode ?? null,
    active_vehicle_id: data?.active_vehicle_id ?? null,
  });
}
