import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson, normalizeStatus } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import { notifyClientTaxiRideCancelled } from "@/lib/clientPushNotifications";
import { stripe } from "@/lib/stripe";
import { releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Driver cancel before ride start. Marks ride canceled and executes Stripe
 * refund immediately when the ride was paid (parity with client cancel).
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
      .select(
        "id,status,client_user_id,payment_status,stripe_payment_intent_id,stripe_refund_id,stripe_refunded_at,payment_funding,business_account_id,total_cents,currency"
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

    const result = (data ?? null) as TaxiRpcResult & { refund?: string } | null;
    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    await releaseEntityCredit(auth.supabaseAdmin, "taxi_ride", rideId).catch(
      () => undefined
    );

    let stripeRefund: {
      refunded: boolean;
      deferred: boolean;
      refundId?: string;
      status?: string | null;
      error?: string;
    } = { refunded: false, deferred: false };

    const refundRequired = String(result.refund ?? "") === "REQUIRED";
    const wasPaid = normalizeStatus(rideBefore?.payment_status) === "paid";
    const paymentFunding = String(
      (rideBefore as { payment_funding?: string | null } | null)?.payment_funding ??
        "stripe"
    ).toLowerCase();

    if (refundRequired && wasPaid && !rideBefore?.stripe_refund_id) {
      if (paymentFunding === "business_wallet") {
        try {
          const { creditBusinessWalletRefund } = await import(
            "@/lib/taxiBusinessWalletService"
          );
          const bizId = String(
            (rideBefore as { business_account_id?: string | null })
              ?.business_account_id ?? ""
          );
          if (bizId) {
            await creditBusinessWalletRefund(auth.supabaseAdmin, {
              businessAccountId: bizId,
              taxiRideId: rideId,
              amountCents: Number(
                (rideBefore as { total_cents?: number | null })?.total_cents ?? 0
              ),
              currency: String(
                (rideBefore as { currency?: string | null })?.currency ?? "USD"
              ),
              reason: "driver_cancel",
            });
          }
          await auth.supabaseAdmin
            .from("taxi_rides")
            .update({
              refund_status: "refunded",
              payment_status: "refunded",
              stripe_refunded_at: new Date().toISOString(),
            })
            .eq("id", rideId);
          stripeRefund = { refunded: true, deferred: false, status: "business_wallet" };
        } catch (e) {
          stripeRefund = {
            refunded: false,
            deferred: true,
            error: e instanceof Error ? e.message : String(e),
          };
          await auth.supabaseAdmin
            .from("taxi_rides")
            .update({ refund_status: "refund_failed" })
            .eq("id", rideId);
        }
      } else {
        const paymentIntentId = String(
          rideBefore?.stripe_payment_intent_id ?? ""
        ).trim();
        if (paymentIntentId) {
          try {
            const refund = await stripe.refunds.create(
              {
                payment_intent: paymentIntentId,
                reason: "requested_by_customer",
                metadata: {
                  module: "taxi",
                  taxi_ride_id: rideId,
                  cancel_reason: reason,
                  cancelled_by: "driver",
                },
              },
              { idempotencyKey: `refund_taxi_driver_cancel_${rideId}` }
            );
            const now = new Date().toISOString();
            await auth.supabaseAdmin
              .from("taxi_rides")
              .update({
                refund_status: "refunded",
                stripe_refund_id: refund.id,
                stripe_refunded_at: now,
                payment_status: "refunded",
              })
              .eq("id", rideId);
            stripeRefund = {
              refunded: true,
              deferred: false,
              refundId: refund.id,
              status: refund.status,
            };
          } catch (refundErr: unknown) {
            const message =
              refundErr instanceof Error ? refundErr.message : String(refundErr);
            console.error("taxi driver-cancel refund error:", message);
            await auth.supabaseAdmin
              .from("taxi_rides")
              .update({ refund_status: "refund_failed" })
              .eq("id", rideId);
            stripeRefund = { refunded: false, deferred: false, error: message };
          }
        } else {
          stripeRefund = {
            refunded: false,
            deferred: true,
            error: "missing_payment_intent",
          };
        }
      }
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_cancel",
      oldStatus: String(rideBefore?.status ?? ""),
      newStatus: "canceled",
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver cancelled taxi ride via API",
      metadata: {
        reason,
        refund: result.refund ?? "NONE",
        stripe_refund: stripeRefund,
      },
    });

    if (rideBefore?.client_user_id) {
      await notifyClientTaxiRideCancelled({
        supabaseAdmin: auth.supabaseAdmin,
        userIds: [rideBefore.client_user_id],
        taxiRideId: rideId,
        refund: refundRequired ? "REQUIRED" : "NONE",
      }).catch(() => undefined);
    }

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      result,
      refund: result.refund ?? "NONE",
      stripeRefund,
      message: stripeRefund.refunded
        ? "Course annulée. Remboursement effectué."
        : refundRequired
          ? "Course annulée. Remboursement en cours de traitement."
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
