import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  transitionMarketplaceSellerOrderStatus,
  type MarketplaceSellerStatusTransition,
} from "@/lib/marketplaceOrderLifecycle";
import { SELLER_CANCEL_REASONS, parseStructuredCancelReason } from "@/lib/cancellationReasons";
import { recordServiceCancellation } from "@/lib/serviceCancellationAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set<MarketplaceSellerStatusTransition>([
  "accepted",
  "refused",
  "preparing",
  "ready",
  "out_for_delivery",
]);

type Body = {
  order_id?: string;
  status?: string;
  cancel_reason?: string | null;
  reason_code?: string | null;
  reason_detail?: string | null;
  reason_note?: string | null;
};

export async function POST(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  const nextStatus = String(body.status ?? "").trim() as MarketplaceSellerStatusTransition;

  if (!orderId) {
    return mmdLocationJson({ ok: false, error: "Missing order_id" }, 400);
  }
  if (!ALLOWED.has(nextStatus)) {
    return mmdLocationJson({ ok: false, error: "Invalid status" }, 400);
  }

  let sellerReason: { reasonCode: string; reasonNote: string | null } | null = null;
  if (nextStatus === "refused") {
    const parsedReason = parseStructuredCancelReason(
      {
        reasonCode: body.reason_code ?? body.cancel_reason,
        reasonNote: body.reason_detail ?? body.reason_note,
      },
      SELLER_CANCEL_REASONS,
    );
    if (parsedReason.ok === false) {
      return mmdLocationJson(
        { ok: false, error: parsedReason.error, allowed_reasons: parsedReason.allowed },
        400,
      );
    }
    sellerReason = { reasonCode: parsedReason.reasonCode, reasonNote: parsedReason.reasonNote };
  }

  try {
    const { data: before } = await auth.supabaseAdmin
      .from("seller_orders")
      .select("status,payment_status")
      .eq("id", orderId)
      .maybeSingle();

    const result = await transitionMarketplaceSellerOrderStatus(auth.supabaseAdmin, {
      sellerUserId: auth.user.id,
      orderId,
      nextStatus,
      cancelReason: nextStatus === "refused" ? "refused_by_seller" : body.cancel_reason ?? null,
    });

    if (result.ok === false) {
      const status =
        result.error === "order_not_found" || result.error === "seller_not_found"
          ? 404
          : result.error === "invalid_status_transition" || result.error === "order_not_paid"
            ? 409
            : 400;
      return mmdLocationJson({ ok: false, error: result.error }, status);
    }

    if (sellerReason) {
      await recordServiceCancellation(auth.supabaseAdmin, {
        entityType: "seller_order",
        entityId: orderId,
        serviceType: "marketplace",
        actorUserId: auth.user.id,
        actorRole: "seller",
        reasonCode: sellerReason.reasonCode,
        reasonNote: sellerReason.reasonNote,
        previousStatus: before?.status ? String(before.status) : null,
        resultingStatus: "refused",
        paymentStatus: String(result.order.payment_status ?? before?.payment_status ?? ""),
        acceptanceRateImpact: false,
        cancellationSource: "seller_refuse",
        metadata: {
          policy_cancel_reason: "refused_by_seller",
          refund_status: result.refund_status ?? null,
        },
      });
    }

    return mmdLocationJson({
      ok: true,
      order: result.order,
      refund_status: result.refund_status ?? null,
      stripe_refund_id: result.stripe_refund_id ?? null,
      stripe_refund_deferred: Boolean(result.stripe_refund_deferred),
      message: result.stripe_refund_deferred
        ? "Order refused. Stripe refund could not be completed automatically — marked for retry."
        : result.refund_status === "refunded"
          ? "Order refused. Stripe refund completed."
          : undefined,
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}
