import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { assertMarketplaceLiveMoneyAllowed } from "@/lib/marketplaceLaunchControl";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";
import { getClientMarketplaceOrder } from "@/lib/marketplaceOrderService";
import { handleMarketplaceStripePayment } from "@/lib/marketplaceStripeWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  order_id?: string;
  session_id?: string;
};

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

function stripeCheckoutSessionLooksPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.status === "complete";
}

export async function POST(req: NextRequest) {
  const e2eGate = assertMarketplaceLiveMoneyAllowed();
  if (e2eGate.ok === false) {
    return mmdLocationJson(
      { ok: false, error: e2eGate.error, message: e2eGate.message },
      403
    );
  }

  const auth = await requireMarketplaceClientAuth(req);
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

  const order = await getClientMarketplaceOrder(auth.supabaseAdmin, {
    clientUserId: auth.user.id,
    orderId,
  });
  if (!order) {
    return mmdLocationJson({ ok: false, error: "order_not_found" }, 404);
  }

  if (order.payment_status === "paid" || order.status === "paid") {
    return mmdLocationJson({
      ok: true,
      already_paid: true,
      stripe_paid: true,
      payment_status: order.payment_status ?? "paid",
      order,
    });
  }

  const sessionId =
    String(body.session_id ?? order.stripe_checkout_session_id ?? "").trim() || null;

  let session: Stripe.Checkout.Session | null = null;
  let paymentIntentId = order.stripe_payment_intent_id ?? null;

  if (sessionId) {
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });
      paymentIntentId =
        paymentIntentIdFromUnknown(session.payment_intent) ?? paymentIntentId;
    } catch {
      return mmdLocationJson(
        { ok: false, error: "checkout_session_not_found", order },
        404
      );
    }
  }

  if (!session || !stripeCheckoutSessionLooksPaid(session)) {
    return mmdLocationJson(
      {
        ok: false,
        error: "payment_not_completed",
        payment_status: session?.payment_status ?? order.payment_status ?? null,
        order,
      },
      402
    );
  }

  const result = await handleMarketplaceStripePayment({
    supabaseAdmin: auth.supabaseAdmin,
    sellerOrderId: orderId,
    sessionId,
    paymentIntentId,
    expectedAmountCents: order.total_cents,
    expectedCurrency: order.currency,
    source: "client_confirm_paid",
    session,
    metadata: (session.metadata ?? null) as Record<string, unknown> | null,
  });

  if (!result.ok) {
    return mmdLocationJson(
      { ok: false, error: result.error ?? "confirm_failed", order },
      400
    );
  }

  const refreshed = await getClientMarketplaceOrder(auth.supabaseAdmin, {
    clientUserId: auth.user.id,
    orderId,
  });

  return mmdLocationJson({
    ok: true,
    already_paid: result.already_paid ?? false,
    stripe_paid: refreshed?.payment_status === "paid",
    payment_status: refreshed?.payment_status ?? null,
    order: refreshed,
  });
}
