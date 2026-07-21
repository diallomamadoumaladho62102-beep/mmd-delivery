import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { loadDriverAreaIntelligence } from "@/lib/loadDriverAreaIntelligence";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const radiusMiles = Number(req.nextUrl.searchParams.get("radius_miles") ?? 5);
  const isOnlineParam = req.nextUrl.searchParams.get("is_online");
  const isOnline =
    isOnlineParam == null
      ? true
      : isOnlineParam === "1" || isOnlineParam === "true";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json(
      { ok: false, error: "lat_lng_required", message: "GPS coordinates are required." },
      400
    );
  }

  try {
    // Prefer live is_online from profile when client omits flag
    let online = isOnline;
    if (isOnlineParam == null) {
      const { data: profile } = await auth.supabaseAdmin
        .from("driver_profiles")
        .select("is_online")
        .eq("user_id", auth.userId)
        .maybeSingle();
      online = profile?.is_online === true;
    }

    const intelligence = await loadDriverAreaIntelligence(auth.supabaseAdmin, {
      lat,
      lng,
      radiusMiles,
      driverId: auth.userId,
      isOnline: online,
    });

    return json({ ok: true, ...intelligence });
  } catch (e) {
    logTechnicalError("driver.area-intelligence", e, { userId: auth.userId });
    return json(
      {
        ok: false,
        error: "area_intelligence_failed",
        message: toUserFacingError(e, "Unable to load area intelligence."),
      },
      500
    );
  }
}
