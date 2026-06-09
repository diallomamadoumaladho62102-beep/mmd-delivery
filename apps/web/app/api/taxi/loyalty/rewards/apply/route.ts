import { NextRequest } from "next/server";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      reward_id?: string;
      rewardId?: string;
      taxi_ride_id?: string;
      taxiRideId?: string;
    };

    let rideId = "";
    try {
      rideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const rewardId = String(body.reward_id ?? body.rewardId ?? "").trim();
    if (!rewardId) {
      return taxiJson({ ok: false, error: "Missing reward_id" }, 400);
    }

    const { data: ride, error: rideError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id, client_user_id")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) {
      return taxiJson({ ok: false, error: rideError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ ok: false, error: "Taxi ride not found" }, 404);
    }

    if (String(ride.client_user_id) !== auth.user.id) {
      return taxiJson({ ok: false, error: "Forbidden" }, 403);
    }

    const { data, error } = await auth.supabaseAdmin.rpc(
      "apply_taxi_loyalty_reward_to_ride",
      {
        p_ride_id: rideId,
        p_reward_id: rewardId,
        p_user_id: auth.user.id,
      }
    );

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    return taxiJson({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
