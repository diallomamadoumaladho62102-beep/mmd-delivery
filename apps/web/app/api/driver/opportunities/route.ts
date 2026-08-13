import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { loadDriverOpportunitiesFeed } from "@/lib/driverOpportunitiesQuery";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const day = req.nextUrl.searchParams.get("day");
  const category = req.nextUrl.searchParams.get("category");
  const latParam = req.nextUrl.searchParams.get("lat");
  const lngParam = req.nextUrl.searchParams.get("lng");
  const lat = latParam == null || latParam === "" ? null : Number(latParam);
  const lng = lngParam == null || lngParam === "" ? null : Number(lngParam);

  if (lat != null && !Number.isFinite(lat)) {
    return json({ ok: false, error: "invalid_lat", message: "Invalid latitude." }, 400);
  }
  if (lng != null && !Number.isFinite(lng)) {
    return json({ ok: false, error: "invalid_lng", message: "Invalid longitude." }, 400);
  }

  try {
    const opportunities = await loadDriverOpportunitiesFeed(auth.supabaseAdmin, {
      driverUserId: auth.userId,
      day,
      category,
      lat,
      lng,
    });

    return json({ ok: true, opportunities });
  } catch (e) {
    logTechnicalError("driver.opportunities.list", e, { userId: auth.userId });
    return json(
      {
        ok: false,
        error: "opportunities_failed",
        message: toUserFacingError(e, "Unable to load opportunities."),
      },
      500,
    );
  }
}
