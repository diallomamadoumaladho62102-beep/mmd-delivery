import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Driver chooses to keep waiting after the free period.
 * Does not reset the timer, the fee, or the acceptance rate.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let rideId = "";
    try {
      rideId = getTaxiRideId(body);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const { data: ride, error } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id,status,driver_id,wait_timer_started_at,driver_arrived_at")
      .eq("id", rideId)
      .maybeSingle();

    if (error) return taxiJson({ ok: false, error: error.message }, 500);
    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);
    if (String(ride.driver_id ?? "") !== auth.user.id) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }
    if (String(ride.status ?? "").toLowerCase() !== "driver_arrived") {
      return taxiJson({ ok: false, error: "invalid_status" }, 409);
    }
    if (!ride.wait_timer_started_at && !ride.driver_arrived_at) {
      return taxiJson({ ok: false, error: "wait_not_started" }, 409);
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_continue_waiting",
      oldStatus: "driver_arrived",
      newStatus: "driver_arrived",
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver chose to continue waiting. Timer was not reset.",
      metadata: {
        acceptance_rate_impact: false,
        timer_reset: false,
      },
    });

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      timer_reset: false,
      acceptance_rate_impact: false,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
