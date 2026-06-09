import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      scheduled_id?: string;
      scheduledId?: string;
      reason?: string;
    };

    const scheduledId = String(body.scheduled_id ?? body.scheduledId ?? "").trim();
    if (!scheduledId) {
      return taxiJson({ ok: false, error: "Missing scheduled_id" }, 400);
    }

    const { data: scheduled, error: readError } = await auth.supabaseAdmin
      .from("taxi_scheduled_rides")
      .select("id, taxi_ride_id, client_user_id, status")
      .eq("id", scheduledId)
      .maybeSingle();

    if (readError) {
      return taxiJson({ ok: false, error: readError.message }, 500);
    }

    if (!scheduled) {
      return taxiJson({ ok: false, error: "Scheduled ride not found" }, 404);
    }

    if (String(scheduled.client_user_id) !== auth.user.id) {
      return taxiJson({ ok: false, error: "Forbidden" }, 403);
    }

    if (String(scheduled.status) === "dispatched") {
      return taxiJson({ ok: false, error: "scheduled_already_dispatched" }, 400);
    }

    const nowIso = new Date().toISOString();

    await auth.supabaseAdmin
      .from("taxi_scheduled_rides")
      .update({
        status: "canceled",
        canceled_at: nowIso,
        cancel_reason: String(body.reason ?? "client_cancel"),
        updated_at: nowIso,
      })
      .eq("id", scheduledId);

    await auth.supabaseAdmin.rpc("release_taxi_loyalty_redemption", {
      p_ride_id: scheduled.taxi_ride_id,
    });

    await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        status: "canceled",
        cancelled_at: nowIso,
        cancelled_by: "client",
        cancel_reason: String(body.reason ?? "scheduled_cancel"),
        updated_at: nowIso,
      })
      .eq("id", scheduled.taxi_ride_id);

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId: String(scheduled.taxi_ride_id),
      eventType: "scheduled_ride_canceled",
      newStatus: "canceled",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client canceled scheduled taxi ride",
    });

    return taxiJson({ ok: true, scheduled_id: scheduledId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
