import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  cancelMarketplaceOrder,
  loadSellerOwnedByUser,
} from "@/lib/marketplaceOrderLifecycle";
import {
  DELIVERY_CLIENT_CANCEL_REASONS,
  SELLER_CANCEL_REASONS,
  parseStructuredCancelReason,
} from "@/lib/cancellationReasons";
import { recordServiceCancellation } from "@/lib/serviceCancellationAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  order_id?: string;
  cancel_reason?: string | null;
  as_seller?: boolean;
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
  if (!orderId) {
    return mmdLocationJson({ ok: false, error: "Missing order_id" }, 400);
  }

  try {
    let actorRole: "client" | "seller" = "client";
    if (body.as_seller === true) {
      const seller = await loadSellerOwnedByUser(auth.supabaseAdmin, auth.user.id);
      if (!seller) {
        return mmdLocationJson({ ok: false, error: "seller_not_found" }, 404);
      }
      actorRole = "seller";
    }

    const parsedReason = parseStructuredCancelReason(
      {
        reasonCode: body.cancel_reason ?? (body as { reason_code?: string }).reason_code,
        reasonNote: (body as { reason_detail?: string; reason_note?: string }).reason_detail
          ?? (body as { reason_note?: string }).reason_note,
      },
      actorRole === "seller" ? SELLER_CANCEL_REASONS : DELIVERY_CLIENT_CANCEL_REASONS,
    );
    if (parsedReason.ok === false) {
      return mmdLocationJson(
        { ok: false, error: parsedReason.error, allowed_reasons: parsedReason.allowed },
        400,
      );
    }

    const result = await cancelMarketplaceOrder(auth.supabaseAdmin, {
      actorUserId: auth.user.id,
      orderId,
      actorRole,
      cancelReason: parsedReason.reasonCode,
    });

    if (result.ok === false) {
      const status =
        result.error === "order_not_found"
          ? 404
          : result.error === "forbidden"
            ? 403
            : result.error === "order_not_cancellable"
              ? 409
              : 400;
      return mmdLocationJson({ ok: false, error: result.error }, status);
    }

    await recordServiceCancellation(auth.supabaseAdmin, {
      entityType: "seller_order",
      entityId: orderId,
      serviceType: "marketplace",
      actorUserId: auth.user.id,
      actorRole,
      reasonCode: parsedReason.reasonCode,
      reasonNote: parsedReason.reasonNote,
      resultingStatus: String(result.order.status ?? "canceled"),
      paymentStatus: String(result.order.payment_status ?? ""),
      acceptanceRateImpact: false,
      cancellationSource: actorRole === "seller" ? "seller_cancel" : "client_cancel",
      metadata: { refund_status: result.refund_status ?? null },
    });

    return mmdLocationJson({
      ok: true,
      order: result.order,
      refund_status: result.refund_status,
      stripe_refund_id: result.stripe_refund_id ?? null,
      stripe_refund_deferred: Boolean(result.stripe_refund_deferred),
      message: result.stripe_refund_deferred
        ? "Order canceled. Stripe refund could not be completed automatically — marked for retry."
        : result.refund_status === "refunded"
          ? "Order canceled. Stripe refund completed."
          : "Order canceled.",
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}
