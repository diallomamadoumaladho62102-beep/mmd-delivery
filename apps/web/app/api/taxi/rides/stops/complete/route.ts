import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      taxi_ride_id?: string;
      taxiRideId?: string;
      stop_order?: number;
      stopOrder?: number;
    };

    let rideId = "";
    try {
      rideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const stopOrder = Math.round(Number(body.stop_order ?? body.stopOrder ?? 0));
    if (!Number.isFinite(stopOrder) || stopOrder < 1) {
      return taxiJson({ ok: false, error: "Invalid stop_order" }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("driver_complete_taxi_stop", {
      p_ride_id: rideId,
      p_stop_order: stopOrder,
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as TaxiRpcResult | null;
    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_completed_stop",
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver completed taxi stop via API",
      metadata: { stop_order: stopOrder },
    });

    return taxiJson({ ok: true, taxi_ride_id: rideId, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
