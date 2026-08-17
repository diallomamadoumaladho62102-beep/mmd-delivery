import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { adminForceCompleteTaxiRide } from "@/lib/taxiCompleteRideCore";
import { getTaxiRideId } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    // Server-side staff gate — drivers cannot call this even if they know the URL.
    const session = await assertCanManageTaxiRides(req);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    let rideId = "";
    try {
      rideId = getTaxiRideId(body);
    } catch {
      rideId = String(body.rideId ?? body.ride_id ?? "").trim();
    }

    if (!rideId) {
      return json({ ok: false, error: "Missing rideId" }, 400);
    }

    const reason = String(body.reason ?? "admin_force_complete").trim();
    const latRaw = body.lat ?? body.latitude ?? body.driver_lat ?? body.driverLat;
    const lngRaw = body.lng ?? body.longitude ?? body.driver_lng ?? body.driverLng;
    const driverLat =
      latRaw == null || latRaw === "" ? null : Number(latRaw);
    const driverLng =
      lngRaw == null || lngRaw === "" ? null : Number(lngRaw);

    const supabaseAdmin = buildSupabaseAdminClient();
    const result = await adminForceCompleteTaxiRide({
      supabaseAdmin,
      rideId,
      adminUserId: session.userId,
      reason,
      driverLat: Number.isFinite(driverLat) ? driverLat : null,
      driverLng: Number.isFinite(driverLng) ? driverLng : null,
    });

    if (result.ok === false) {
      return json({ ok: false, error: result.error }, result.status);
    }

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "taxi_ride_force_complete",
      targetType: "taxi_ride",
      targetId: rideId,
      oldValues: { status: result.previous_status },
      newValues: { status: result.status },
      metadata: {
        reason,
        action: "admin_force_complete",
        bypassed_proximity: true,
        distance_meters: result.distance_meters,
        driver_gps: result.driver_gps,
        proximity_max_meters: result.proximity_max_meters,
        driver_payout_ok: result.driver_payout?.ok ?? null,
      },
      request: req,
    });

    return json({
      ok: true,
      ...result,
      message: "Admin force-completed taxi ride.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    console.log("Admin taxi force-complete error:", e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status,
    );
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
