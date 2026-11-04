import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";
import {
  isMarketplaceLocalPaymentMethod,
  placeMarketplaceLocalOrder,
} from "@/lib/marketplaceLocalCheckoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LocalCheckoutBody = {
  order_id?: string;
  payment_method?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  if (!auth.scope.checkout_enabled) {
    return mmdLocationJson(
      {
        ok: false,
        error: "platform_checkout_disabled",
        message: "Checkout is disabled in your region",
      },
      403
    );
  }

  let body: LocalCheckoutBody;
  try {
    body = (await req.json()) as LocalCheckoutBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) {
    return mmdLocationJson({ ok: false, error: "Missing order_id" }, 400);
  }

  const paymentMethod = String(body.payment_method ?? "")
    .trim()
    .toLowerCase();
  if (!isMarketplaceLocalPaymentMethod(paymentMethod)) {
    return mmdLocationJson({ ok: false, error: "invalid_payment_method" }, 400);
  }

  try {
    const result = await placeMarketplaceLocalOrder(auth.supabaseAdmin, {
      clientUserId: auth.user.id,
      orderId,
      paymentMethod,
    });

    return mmdLocationJson({ ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const status =
      message === "platform_checkout_disabled" ||
      message === "marketplace_local_checkout_not_available" ||
      message === "guinea_test_live_operation_blocked"
        ? 403
        : message === "Order not found"
          ? 404
          : message === "marketplace_cash_schema_not_ready"
            ? 503
            : 400;
    return mmdLocationJson({ ok: false, error: message }, status);
  }
}
