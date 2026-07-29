import { NextRequest } from "next/server";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let rideId = "";
    try {
      rideId = getTaxiRideId(body);
    } catch (e: unknown) {
      return taxiJson(
        { ok: false, error: e instanceof Error ? e.message : "Invalid request" },
        400
      );
    }

    const reason = String(body.reason ?? body.cancel_reason ?? "").trim();

    const { data, error } = await auth.supabaseAdmin.rpc(
      "reject_taxi_business_ride",
      {
        p_ride_id: rideId,
        p_manager_user_id: auth.user.id,
        p_reason: reason || null,
      }
    );

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) {
      const status = result.error === "forbidden" ? 403 : 400;
      return taxiJson({ ok: false, error: result.error ?? "reject_failed" }, status);
    }

    return taxiJson({ ok: true, taxi_ride_id: rideId, result });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
