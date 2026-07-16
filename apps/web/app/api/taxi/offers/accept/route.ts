import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiOfferId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import { fireTaxiRideDispatchedTransactional } from "@/lib/transactionalDispatchNotify";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";
import { notifyDriverVehicleEvent } from "@/lib/driverPushNotifications";
import { notifyClientTaxiRideAccepted } from "@/lib/clientPushNotifications";
import {
  TAXI_ACCEPT_REASON_MESSAGES,
  type TaxiAcceptRejectReason,
} from "@/lib/taxiCategoryMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function notifyDriverAcceptRejected(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any;
  driverUserId: string;
  reasonCode: string;
  reasonMessage: string | null;
  taxiRideId: string;
  offerId: string;
}) {
  const code = params.reasonCode as TaxiAcceptRejectReason;
  const body =
    params.reasonMessage ??
    TAXI_ACCEPT_REASON_MESSAGES[code] ??
    TAXI_ACCEPT_REASON_MESSAGES.validation_failed;

  await notifyDriverVehicleEvent({
    supabaseAdmin: params.supabaseAdmin,
    driverUserId: params.driverUserId,
    kind: "taxi_accept_rejected",
    reason: body,
    metadata: {
      type: "taxi_accept_rejected",
      reason_code: params.reasonCode,
      taxi_ride_id: params.taxiRideId,
      offer_id: params.offerId,
    },
  });
}

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

    const { data, error } = await auth.supabaseUser.rpc("driver_accept_taxi_offer", {
      p_offer_id: offerId,
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as TaxiRpcResult & {
      should_redispatch?: boolean;
      taxi_ride_id?: string;
      reason_message?: string;
    };

    if (!result?.ok) {
      const reasonCode = String(result?.message ?? result?.error ?? "validation_failed");
      const reasonMessage = result?.reason_message ?? null;
      const taxiRideId = String(result?.taxi_ride_id ?? "");

      await notifyDriverAcceptRejected({
        supabaseAdmin: auth.supabaseAdmin,
        driverUserId: auth.user.id,
        reasonCode,
        reasonMessage,
        taxiRideId,
        offerId,
      });

      if (result?.should_redispatch && taxiRideId) {
        const { data: rideRow } = await auth.supabaseAdmin
          .from("taxi_rides")
          .select("dispatch_wave")
          .eq("id", taxiRideId)
          .maybeSingle();

        const wave = Number(rideRow?.dispatch_wave ?? 1);

        await logTaxiEventServer(auth.supabaseAdmin, {
          rideId: taxiRideId,
          eventType: "accept_rejected_redispatch",
          oldStatus: "dispatching",
          newStatus: "dispatching",
          actorId: auth.user.id,
          triggeredRole: "driver",
          description: "Taxi accept rejected — automatic redispatch",
          metadata: { offer_id: offerId, reason_code: reasonCode, reason_message: reasonMessage },
        });

        await runTaxiRideDispatch({
          supabase: auth.supabaseAdmin,
          taxiRideId,
          wave: Number.isFinite(wave) ? wave : 1,
        });
      }

      const mapped = mapTaxiRpcError(reasonCode);
      return taxiJson(
        {
          ok: false,
          error: reasonMessage ?? mapped.message,
          reason_code: reasonCode,
          reason_message: reasonMessage,
        },
        mapped.status,
      );
    }

    const taxiRideId = String(
      (result as Record<string, unknown>).taxi_ride_id ?? "",
    );

    if (taxiRideId) {
      await logTaxiEventServer(auth.supabaseAdmin, {
        rideId: taxiRideId,
        eventType: "offer_accepted",
        oldStatus: "dispatching",
        newStatus: "accepted",
        actorId: auth.user.id,
        triggeredRole: "driver",
        description: "Driver accepted taxi offer via API",
        metadata: { offer_id: offerId, vehicle_id: (result as Record<string, unknown>).vehicle_id },
      });

      await fireTaxiRideDispatchedTransactional({
        supabaseAdmin: auth.supabaseAdmin,
        taxiRideId,
      });

      const { data: rideRow } = await auth.supabaseAdmin
        .from("taxi_rides")
        .select("client_user_id")
        .eq("id", taxiRideId)
        .maybeSingle();

      await notifyClientTaxiRideAccepted({
        supabaseAdmin: auth.supabaseAdmin,
        userIds: [rideRow?.client_user_id],
        taxiRideId,
      }).catch((err) => {
        console.log(
          "[taxi accept] client push error:",
          err instanceof Error ? err.message : err,
        );
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
