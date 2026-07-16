import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import { notifyClientTaxiRideCancelled } from "@/lib/clientPushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Driver cancel before ride start. Marks refund required when paid,
 * without moving Live Stripe money (admin refund path remains).
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

    const reason = String(body.reason ?? body.cancel_reason ?? "driver_cancelled").trim();

    const { data: rideBefore } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id,status,client_user_id,payment_status")
      .eq("id", rideId)
      .maybeSingle();

    const { data, error } = await auth.supabaseUser.rpc("driver_cancel_taxi_ride", {
      p_ride_id: rideId,
      p_reason: reason.slice(0, 120),
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as TaxiRpcResult & { refund?: string } | null;
    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_cancel",
      oldStatus: String(rideBefore?.status ?? ""),
      newStatus: "canceled",
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver cancelled taxi ride via API (Stripe deferred)",
      metadata: {
        reason,
        refund: result.refund ?? "NONE",
        stripe_refund_deferred: true,
      },
    });

    if (rideBefore?.client_user_id) {
      await notifyClientTaxiRideCancelled({
        supabaseAdmin: auth.supabaseAdmin,
        userIds: [rideBefore.client_user_id],
        taxiRideId: rideId,
        refund: String(result.refund ?? "NONE") === "REQUIRED" ? "REQUIRED" : "NONE",
      }).catch(() => undefined);
    }

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      result,
      refund: result.refund ?? "NONE",
      stripeRefund: { refunded: false, deferred: true },
      message:
        result.refund === "REQUIRED"
          ? "Course annulée. Remboursement à traiter (aucun mouvement Stripe immédiat)."
          : "Course annulée.",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
