import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  transitionMarketplaceSellerOrderStatus,
  type MarketplaceSellerStatusTransition,
} from "@/lib/marketplaceOrderLifecycle";

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

  try {
    const result = await transitionMarketplaceSellerOrderStatus(auth.supabaseAdmin, {
      sellerUserId: auth.user.id,
      orderId,
      nextStatus,
      cancelReason: body.cancel_reason ?? null,
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

    return mmdLocationJson({
      ok: true,
      order: result.order,
      ...(result.stripe_refund_deferred
        ? {
            stripe_refund_deferred: true,
            refund_status: result.refund_status,
            message:
              "Order refused. Full refund marked as required — Stripe refund is deferred (not executed).",
          }
        : {}),
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}
