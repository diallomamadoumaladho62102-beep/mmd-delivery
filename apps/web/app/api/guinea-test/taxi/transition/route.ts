import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { isGuineaIsolatedTestUserId } from "@/lib/guineaTestIsolation";
import { transitionIsolatedTaxiRide } from "@/lib/guineaIsolatedTaxiJourney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Controlled Guinea rehearsal transitions. Identity is the authenticated user
 * id (server-side allow-list). A mobile body flag cannot open this path.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    if (!isGuineaIsolatedTestUserId(auth.user.id)) {
      return taxiJson({ ok: false, error: "guinea_isolated_actor_required" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rideId = String(body.taxi_ride_id ?? body.taxiRideId ?? body.ride_id ?? "").trim();
    const action = String(body.action ?? "").trim().toLowerCase();
    if (!rideId) return taxiJson({ ok: false, error: "missing_taxi_ride_id" }, 400);
    if (!["arrive", "start", "complete", "cancel"].includes(action)) {
      return taxiJson({ ok: false, error: "unsupported_action" }, 400);
    }

    const lat = Number(body.lat ?? body.latitude ?? body.driver_lat);
    const lng = Number(body.lng ?? body.longitude ?? body.driver_lng);
    const result = await transitionIsolatedTaxiRide({
      admin: auth.supabaseAdmin,
      actorUserId: auth.user.id,
      rideId,
      action: action as "arrive" | "start" | "complete" | "cancel",
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      pickupCode: String(body.pickup_code ?? body.pickupCode ?? ""),
    });

    return taxiJson({
      ok: true,
      previous_status: result.previousStatus,
      ride: {
        id: result.ride.id,
        status: result.ride.status,
        payment_status: result.ride.payment_status,
        payment_method: result.ride.payment_method,
        currency: result.ride.currency,
        total_cents: result.ride.total_cents,
        is_test: result.ride.is_test,
        driver_id: result.ride.driver_id,
        client_user_id: result.ride.client_user_id,
        pickup_verification_code:
          action === "start" || action === "complete"
            ? null
            : result.ride.pickup_verification_code,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status =
      message === "guinea_isolated_actor_required" ||
      message === "guinea_isolated_ride_required" ||
      message === "forbidden" ||
      message === "driver_actor_required"
        ? 403
        : message === "ride_not_found"
          ? 404
          : 400;
    return taxiJson({ ok: false, error: message }, status);
  }
}
