import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  cancelMarketplaceOrder,
  loadSellerOwnedByUser,
} from "@/lib/marketplaceOrderLifecycle";

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

    const result = await cancelMarketplaceOrder(auth.supabaseAdmin, {
      actorUserId: auth.user.id,
      orderId,
      actorRole,
      cancelReason: body.cancel_reason ?? null,
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
