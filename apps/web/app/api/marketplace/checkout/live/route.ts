import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import {
  isMarketplaceCheckoutLiveEnvEnabled,
  MARKETPLACE_CHECKOUT_LIVE_COMING_SOON,
} from "@/lib/marketplaceLiveCheckout";
import { createMarketplaceLiveCheckoutSession } from "@/lib/marketplaceLiveCheckoutService";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveCheckoutBody = {
  order_id?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  const checkoutLiveEnabled = auth.scope.marketplace_checkout_live_enabled;

  if (!checkoutLiveEnabled) {
    return mmdLocationJson(
      {
        ok: false,
        error: "marketplace_live_checkout_disabled",
        live_checkout_enabled: false,
        message: isMarketplaceCheckoutLiveEnvEnabled()
          ? "Marketplace live checkout is disabled in your region"
          : MARKETPLACE_CHECKOUT_LIVE_COMING_SOON,
      },
      403
    );
  }

  if (!auth.scope.checkout_enabled) {
    return mmdLocationJson(
      {
        ok: false,
        error: "platform_checkout_disabled",
        live_checkout_enabled: true,
        message: "Checkout is disabled in your region",
      },
      403
    );
  }

  let body: LiveCheckoutBody;
  try {
    body = (await req.json()) as LiveCheckoutBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const orderId = String(body.order_id ?? "").trim();
  if (!orderId) {
    return mmdLocationJson({ ok: false, error: "Missing order_id" }, 400);
  }

  try {
    const result = await createMarketplaceLiveCheckoutSession(auth.supabaseAdmin, {
      clientUserId: auth.user.id,
      orderId,
      platformCheckoutEnabled: auth.scope.checkout_enabled,
      marketplaceCheckoutLiveEnabled: checkoutLiveEnabled,
    });

    return mmdLocationJson({
      ok: true,
      live_checkout_enabled: true,
      checkout_url: result.checkoutUrl,
      stripe_checkout_session_id: result.stripeCheckoutSessionId,
      stripe_payment_intent_id: result.stripePaymentIntentId,
      totals: result.totals,
      order: result.order,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const status =
      message === "marketplace_live_checkout_disabled" ||
      message === "platform_checkout_disabled"
        ? 403
        : 400;
    return mmdLocationJson({ ok: false, error: message }, status);
  }
}

export async function GET() {
  const envEnabled = isMarketplaceCheckoutLiveEnvEnabled();
  return mmdLocationJson({
    ok: true,
    live_checkout_env_enabled: envEnabled,
    live_checkout_enabled: envEnabled,
    message: envEnabled ? null : MARKETPLACE_CHECKOUT_LIVE_COMING_SOON,
  });
}
