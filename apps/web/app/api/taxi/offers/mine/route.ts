import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const nowIso = new Date().toISOString();

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_offers")
      .select(
        `
        *,
        taxi_rides:taxi_ride_id (
          id,
          status,
          pickup_address,
          dropoff_address,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng,
          driver_payout_cents,
          total_cents,
          vehicle_class,
          payment_status,
          preferred_driver_id
        )
      `
      )
      .eq("driver_id", auth.user.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, offers: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
