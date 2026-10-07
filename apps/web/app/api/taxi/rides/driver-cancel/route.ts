import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import { notifyClientTaxiRideCancelled } from "@/lib/clientPushNotifications";
import { parseStructuredCancelReason } from "@/lib/cancellationReasons";
import { recordServiceCancellation } from "@/lib/serviceCancellationAudit";
import { TAXI_DRIVER_CANCEL_REASONS } from "@/lib/taxi/taxiCancellationPolicy";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Driver releases an accepted (pre-start) ride back to the dispatch pool.
 * Does NOT cancel the ride, does NOT refund the client, does NOT create earnings.
 * Triggers nearest-eligible reassignment via existing taxi dispatch.
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

    const parsedReason = parseStructuredCancelReason(
      {
        reasonCode: body.reason_code ?? body.reasonCode ?? body.reason,
        reasonNote: body.reason_detail ?? body.reasonDetail ?? body.reason_note,
      },
      TAXI_DRIVER_CANCEL_REASONS,
    );
    if (parsedReason.ok === false) {
      return taxiJson(
        {
          ok: false,
          error: parsedReason.error,
          allowed_reasons: parsedReason.allowed,
        },
        400,
      );
    }
    const reasonCode = parsedReason.reasonCode;
    const reasonDetail = parsedReason.reasonNote ?? "";
    const reason = reasonCode;

    const { data: rideBefore } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,status,client_user_id,payment_status,driver_id,country_code,currency",
      )
      .eq("id", rideId)
      .maybeSingle();

    const { data, error } = await auth.supabaseUser.rpc("driver_cancel_taxi_ride", {
      p_ride_id: rideId,
      p_reason: reason.slice(0, 120),
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as
      | (TaxiRpcResult & {
          refund?: string;
          reassign?: boolean;
          previous_driver_id?: string;
          status?: string;
        })
      | null;
    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        cancel_reason_code: reasonCode,
        cancel_reason_detail: reasonDetail || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rideId);

    await recordServiceCancellation(auth.supabaseAdmin, {
      entityType: "taxi_ride",
      entityId: rideId,
      serviceType: "taxi",
      actorUserId: auth.user.id,
      actorRole: "driver",
      reasonCode,
      reasonNote: reasonDetail || null,
      previousStatus: String(rideBefore?.status ?? ""),
      resultingStatus: String(result.status ?? "dispatching"),
      paymentStatus: String(rideBefore?.payment_status ?? ""),
      refundAmountCents: 0,
      acceptanceRateImpact: false,
      cancellationRateImpact: true,
      cancellationSource: "driver_release",
      postAcceptance: true,
      metadata: { reassign: true, refund: "NONE" },
    });

    let dispatch: { ok: boolean; error?: string } = { ok: false };
    try {
      await runTaxiRideDispatch({
        supabase: auth.supabaseAdmin,
        taxiRideId: rideId,
      });
      dispatch = { ok: true };
    } catch (e: unknown) {
      dispatch = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_release_reassign",
      oldStatus: String(rideBefore?.status ?? ""),
      newStatus: String(result.status ?? "dispatching"),
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver released ride for automatic reassignment",
      metadata: {
        reason_code: reasonCode,
        reason_detail: reasonDetail || null,
        activity_impact: false,
        acceptance_rate_impact: false,
        dispatch,
        previous_driver_id: result.previous_driver_id ?? auth.user.id,
      },
    });

    if (rideBefore?.client_user_id) {
      await notifyClientTaxiRideCancelled({
        supabaseAdmin: auth.supabaseAdmin,
        userIds: [rideBefore.client_user_id],
        taxiRideId: rideId,
        refund: "NONE",
      }).catch(() => undefined);
    }

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      reassign: true,
      result,
      refund: "NONE",
      dispatch,
      activity_impact: false,
      acceptance_rate_impact: false,
      message:
        "Ride released. Searching for another nearby driver. The customer is not refunded. This does not reduce your acceptance rate.",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
