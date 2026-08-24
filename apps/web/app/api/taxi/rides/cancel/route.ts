import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  getTaxiRideId,
  normalizeStatus,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { stripe } from "@/lib/stripe";
import {
  isDriverAtDestination,
  normalizeTaxiCancelReason,
  planClientTaxiCancellation,
  TAXI_CLIENT_CANCEL_REASONS,
} from "@/lib/taxi/taxiCancellationPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadDriverAtDestination(
  supabaseAdmin: Parameters<typeof isDriverAtDestination>[0] extends never
    ? never
    : {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              a: string,
              b: string,
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  lat?: number | null;
                  lng?: number | null;
                  latitude?: number | null;
                  longitude?: number | null;
                } | null;
              }>;
              order?: (
                c: string,
                o: { ascending: boolean },
              ) => {
                limit: (n: number) => {
                  maybeSingle: () => Promise<{
                    data: {
                      lat?: number | null;
                      lng?: number | null;
                      latitude?: number | null;
                      longitude?: number | null;
                    } | null;
                  }>;
                };
              };
            };
          };
        };
      },
  driverId: string,
  dropoffLat: number | null,
  dropoffLng: number | null,
): Promise<boolean> {
  try {
    const { data } = await (supabaseAdmin as any)
      .from("driver_locations")
      .select("lat,lng,latitude,longitude")
      .eq("driver_id", driverId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lat = Number(data?.lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.longitude);
    return isDriverAtDestination({
      driverLat: lat,
      driverLng: lng,
      dropoffLat,
      dropoffLng,
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    let rideId = "";

    try {
      rideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const previewOnly =
      body?.preview === true || body?.preview_only === true;

    const reasonCode = normalizeTaxiCancelReason(
      body?.reason_code ?? body?.reasonCode ?? body?.reason,
      TAXI_CLIENT_CANCEL_REASONS,
    );
    const reasonDetail = String(
      body?.reason_detail ?? body?.reasonDetail ?? "",
    )
      .trim()
      .slice(0, 500);

    if (!previewOnly) {
      if (!reasonCode) {
        return taxiJson(
          {
            ok: false,
            error: "cancel_reason_required",
            message: "Please select a cancellation reason.",
            allowed_reasons: TAXI_CLIENT_CANCEL_REASONS,
          },
          400,
        );
      }
      if (reasonCode === "other" && reasonDetail.length < 3) {
        return taxiJson(
          {
            ok: false,
            error: "cancel_reason_detail_required",
            message: "Please describe why you are cancelling.",
          },
          400,
        );
      }
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const scope = await assertClientOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });

    if (scope.ok === false) {
      return taxiJson({ ok: false, error: scope.error }, scope.status);
    }

    const { data: ride, error: readError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,status,payment_status,driver_id,stripe_payment_intent_id,stripe_refund_id,stripe_refunded_at,refund_status,total_cents,driver_payout_cents,dropoff_lat,dropoff_lng,currency",
      )
      .eq("id", rideId)
      .maybeSingle();

    if (readError) {
      return taxiJson({ ok: false, error: readError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ ok: false, error: "Taxi ride not found" }, 404);
    }

    const status = normalizeStatus(ride.status);

    if (status === "canceled") {
      return taxiJson({
        ok: true,
        cancelled: true,
        alreadyCancelled: true,
        taxi_ride_id: rideId,
      });
    }

    if (status === "completed") {
      return taxiJson(
        { ok: false, error: "Completed ride cannot be cancelled" },
        400,
      );
    }

    const driverId = String(ride.driver_id ?? "").trim();
    let driverAtDestination = false;
    if (driverId && status === "in_progress") {
      driverAtDestination = await loadDriverAtDestination(
        auth.supabaseAdmin as any,
        driverId,
        ride.dropoff_lat != null ? Number(ride.dropoff_lat) : null,
        ride.dropoff_lng != null ? Number(ride.dropoff_lng) : null,
      );
    }

    const plan = planClientTaxiCancellation({
      status,
      driverId: ride.driver_id,
      paymentStatus: String(ride.payment_status ?? ""),
      totalCents: Number(ride.total_cents ?? 0),
      driverPayoutCents: Number(ride.driver_payout_cents ?? 0),
      driverAtDestination,
    });

    if (plan.ok === false) {
      return taxiJson(
        {
          ok: false,
          error: plan.code,
          message: "Ride cannot be cancelled at this stage",
        },
        400,
      );
    }

    const feePreview = {
      phase: plan.phase,
      cancel_fee_cents: plan.cancelFeeCents,
      refund_cents: plan.refundCents,
      keep_cents: plan.keepCents,
      driver_compensation_cents: plan.driverCompensationCents,
      refund_policy: plan.refundPolicy,
      client_fee_pct:
        plan.phase === "after_accept_before_start" ? plan.clientFeePct : null,
      driver_compensation_pct:
        plan.phase === "after_start" ? plan.driverCompensationPct : null,
      driver_at_destination:
        plan.phase === "after_start" ? plan.driverAtDestination : null,
      warning:
        plan.phase === "after_accept_before_start"
          ? `Cancellation fee: ${plan.clientFeePct}% of the trip price will be charged.`
          : plan.phase === "after_start"
            ? "The full trip price is due because the ride has already started."
            : null,
    };

    if (previewOnly) {
      return taxiJson({
        ok: true,
        preview: true,
        taxi_ride_id: rideId,
        fee: feePreview,
        allowed_reasons: TAXI_CLIENT_CANCEL_REASONS,
      });
    }

    const canceledAt = new Date().toISOString();
    const reasonLabel = `${reasonCode}${reasonDetail ? `:${reasonDetail}` : ""}`;

    const { data: updated, error: updateError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        status: "canceled",
        driver_id: null,
        cancel_reason: reasonLabel.slice(0, 200),
        cancel_reason_code: reasonCode,
        cancel_reason_detail: reasonDetail || null,
        cancelled_by: "client",
        cancelled_at: canceledAt,
        cancel_fee_cents: plan.cancelFeeCents,
        driver_cancel_compensation_cents: plan.driverCompensationCents,
        refund_status:
          plan.refundPolicy === "FULL"
            ? "full_refund_required"
            : plan.refundPolicy === "PARTIAL"
              ? "partial_refund_required"
              : "no_refund",
        updated_at: canceledAt,
      })
      .eq("id", rideId)
      .eq("status", ride.status)
      .select("id,status")
      .maybeSingle();

    if (updateError) {
      return taxiJson({ ok: false, error: updateError.message }, 500);
    }

    if (!updated) {
      return taxiJson(
        {
          ok: false,
          error: "Ride status changed. Please refresh and try again.",
        },
        409,
      );
    }

    await releaseEntityCredit(auth.supabaseAdmin, "taxi_ride", rideId);

    let stripeRefund: unknown = null;
    const paymentIntentId = String(ride.stripe_payment_intent_id ?? "").trim();
    const alreadyRefunded = Boolean(ride.stripe_refund_id || ride.stripe_refunded_at);

    if (
      !alreadyRefunded &&
      paymentIntentId &&
      normalizeStatus(ride.payment_status) === "paid" &&
      (plan.refundPolicy === "FULL" || plan.refundPolicy === "PARTIAL") &&
      plan.refundCents > 0
    ) {
      try {
        const refundParams: {
          payment_intent: string;
          reason: "requested_by_customer";
          amount?: number;
          metadata: Record<string, string>;
        } = {
          payment_intent: paymentIntentId,
          reason: "requested_by_customer",
          metadata: {
            module: "taxi",
            taxi_ride_id: rideId,
            cancel_reason: reasonCode ?? "",
            cancel_phase: plan.phase,
            cancel_fee_cents: String(plan.cancelFeeCents),
          },
        };
        if (plan.refundPolicy === "PARTIAL") {
          refundParams.amount = plan.refundCents;
        }
        const refund = await stripe.refunds.create(refundParams, {
          idempotencyKey: `refund_taxi_client_${rideId}_${plan.phase}`,
        });

        stripeRefund = { refundId: refund.id, status: refund.status };

        await auth.supabaseAdmin
          .from("taxi_rides")
          .update({
            refund_status:
              plan.refundPolicy === "PARTIAL" ? "partially_refunded" : "refunded",
            stripe_refund_id: refund.id,
            stripe_refunded_at: canceledAt,
            payment_status:
              plan.refundPolicy === "PARTIAL" ? "partially_refunded" : "refunded",
          })
          .eq("id", rideId);
      } catch (refundErr: unknown) {
        console.log(
          "taxi cancel refund error:",
          refundErr instanceof Error ? refundErr.message : refundErr,
        );
        await auth.supabaseAdmin
          .from("taxi_rides")
          .update({ refund_status: "refund_failed" })
          .eq("id", rideId);
      }
    }

    // After-start: freeze driver compensation into commission snapshot (no new Transfer here).
    if (
      plan.phase === "after_start" &&
      plan.driverCompensationCents > 0 &&
      driverId
    ) {
      try {
        await auth.supabaseAdmin.from("taxi_commissions").upsert(
          {
            taxi_ride_id: rideId,
            driver_cents: plan.driverCompensationCents,
            platform_cents: Math.max(
              0,
              plan.keepCents - plan.driverCompensationCents,
            ),
            driver_paid_out: false,
            updated_at: canceledAt,
          },
          { onConflict: "taxi_ride_id" },
        );
      } catch (e) {
        console.warn(
          "[taxi.client-cancel] commission freeze skipped",
          e instanceof Error ? e.message : e,
        );
      }
    }

    await auth.supabaseAdmin
      .from("taxi_offers")
      .update({ status: "expired", updated_at: canceledAt })
      .eq("taxi_ride_id", rideId)
      .eq("status", "pending");

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "ride_cancelled",
      oldStatus: status,
      newStatus: "canceled",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client cancelled taxi ride",
      metadata: {
        reason_code: reasonCode,
        reason_detail: reasonDetail || null,
        fee: feePreview,
        stripe_refund: stripeRefund,
      },
    });

    return taxiJson({
      ok: true,
      cancelled: true,
      taxi_ride_id: rideId,
      refund: plan.refundPolicy,
      fee: feePreview,
      stripeRefund,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
