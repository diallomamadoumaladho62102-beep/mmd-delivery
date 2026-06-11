import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import {
  isMarketplaceCheckoutEnabled,
  MARKETPLACE_CHECKOUT_COMING_SOON,
} from "@/lib/marketplaceCheckout";
import { isMarketplaceCheckoutLiveEnabled } from "@/lib/marketplaceLiveCheckout";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";
import { runMarketplaceCheckoutShadow } from "@/lib/marketplaceOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  order_id?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) {
    return mmdLocationJson({ ok: false, error: "Missing order_id" }, 400);
  }

  try {
    const result = await runMarketplaceCheckoutShadow(auth.supabaseAdmin, {
      clientUserId: auth.user.id,
      orderId,
    });

    const checkoutEnabled = isMarketplaceCheckoutEnabled();

    return mmdLocationJson({
      ok: true,
      checkout_enabled: checkoutEnabled,
      live_checkout_enabled: isMarketplaceCheckoutLiveEnabled(),
      stripe_checkout_created: false,
      message: checkoutEnabled ? null : MARKETPLACE_CHECKOUT_COMING_SOON,
      shadow: result.shadow,
      order: result.order,
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      400
    );
  }
}
