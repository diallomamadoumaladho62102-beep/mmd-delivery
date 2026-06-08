import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiOfferId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    let offerId = "";

    try {
      offerId = getTaxiOfferId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const { data: offerRow } = await auth.supabaseAdmin
      .from("taxi_offers")
      .select("taxi_ride_id")
      .eq("id", offerId)
      .eq("driver_id", auth.user.id)
      .maybeSingle();

    const { data, error } = await auth.supabaseUser.rpc("driver_reject_taxi_offer", {
      p_offer_id: offerId,
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as TaxiRpcResult | null;

    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    if (offerRow?.taxi_ride_id) {
      await logTaxiEventServer(auth.supabaseAdmin, {
        rideId: String(offerRow.taxi_ride_id),
        eventType: "offer_rejected",
        actorId: auth.user.id,
        triggeredRole: "driver",
        description: "Driver rejected taxi offer via API",
        metadata: { offer_id: offerId },
      });
    }

    return taxiJson({ ok: true, offer_id: offerId, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
