import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id } = await context.params;
    const sharedRideId = String(id ?? "").trim();
    if (!sharedRideId) {
      return taxiJson({ ok: false, error: "Missing shared ride id" }, 400);
    }

    const { data: passenger, error: passengerError } = await auth.supabaseAdmin
      .from("taxi_shared_ride_passengers")
      .select(
        `
        id,
        segment_order,
        pickup_address,
        dropoff_address,
        share_discount_cents,
        status,
        taxi_rides:taxi_ride_id (
          id,
          total_cents,
          payment_status,
          status
        )
      `
      )
      .eq("shared_ride_id", sharedRideId)
      .eq("client_user_id", auth.user.id)
      .maybeSingle();

    if (passengerError) {
      return taxiJson({ ok: false, error: passengerError.message }, 500);
    }

    if (!passenger?.id) {
      return taxiJson({ ok: false, error: "shared_ride_not_found" }, 404);
    }

    const { data: shared, error: sharedError } = await auth.supabaseAdmin
      .from("taxi_shared_rides")
      .select(
        "id,status,passenger_count,max_passengers,discount_percent,window_expires_at"
      )
      .eq("id", sharedRideId)
      .maybeSingle();

    if (sharedError) {
      return taxiJson({ ok: false, error: sharedError.message }, 500);
    }

    return taxiJson({
      ok: true,
      shared_ride: shared,
      my_segment: {
        id: passenger.id,
        segment_order: passenger.segment_order,
        pickup_address: passenger.pickup_address,
        dropoff_address: passenger.dropoff_address,
        share_discount_cents: passenger.share_discount_cents,
        status: passenger.status,
        taxi_ride: passenger.taxi_rides,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
