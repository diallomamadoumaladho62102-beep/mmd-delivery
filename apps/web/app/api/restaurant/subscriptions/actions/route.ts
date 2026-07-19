import { NextRequest, NextResponse } from "next/server";
import { requireRestaurantApiUser } from "@/lib/restaurantCommandCenterAuth";
import {
  cancelSubscription,
  changeSubscriptionPlan,
  getActiveSubscription,
  resumeSubscription,
} from "@/lib/subscriptions/subscriptionEngine";
import {
  createBillingPortalSession,
  createSubscriptionCheckoutSession,
} from "@/lib/subscriptions/stripeBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRestaurantApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, restaurantUserId } = auth.ctx;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    if (action === "checkout") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return NextResponse.json({ ok: false, error: "Missing plan_id" }, { status: 400 });
      const result = await createSubscriptionCheckoutSession({
        supabaseAdmin: admin,
        partnerType: "restaurant",
        partnerUserId: restaurantUserId,
        planId,
      });
      if (result.ok === false) {
        return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 400 });
      }
      return NextResponse.json({ ok: true, checkout_url: result.checkoutUrl, session_id: result.sessionId });
    }

    if (action === "portal") {
      const current = await getActiveSubscription(admin, "restaurant", restaurantUserId);
      if (!current?.stripe_customer_id) {
        return NextResponse.json({ ok: false, error: "Aucun client Stripe lié" }, { status: 400 });
      }
      const result = await createBillingPortalSession({
        stripeCustomerId: current.stripe_customer_id,
        returnPath: "/restaurant/subscriptions",
      });
      if (result.ok === false) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, portal_url: result.portalUrl });
    }

    if (action === "cancel") {
      const current = await getActiveSubscription(admin, "restaurant", restaurantUserId);
      if (!current) return NextResponse.json({ ok: false, error: "Aucun abonnement actif" }, { status: 400 });
      const result = await cancelSubscription(admin, current.id, {
        atPeriodEnd: body.at_period_end !== false,
        reason: typeof body.reason === "string" ? body.reason : "partner_cancel",
      });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "resume") {
      const current = await getActiveSubscription(admin, "restaurant", restaurantUserId);
      if (!current) return NextResponse.json({ ok: false, error: "Aucun abonnement" }, { status: 400 });
      const result = await resumeSubscription(admin, current.id);
      return NextResponse.json({ ok: true, result });
    }

    if (action === "change_plan") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return NextResponse.json({ ok: false, error: "Missing plan_id" }, { status: 400 });
      const current = await getActiveSubscription(admin, "restaurant", restaurantUserId);
      if (!current) {
        // No active sub → start checkout for new plan
        const result = await createSubscriptionCheckoutSession({
          supabaseAdmin: admin,
          partnerType: "restaurant",
          partnerUserId: restaurantUserId,
          planId,
        });
        if (result.ok === false) {
          return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 400 });
        }
        return NextResponse.json({ ok: true, checkout_url: result.checkoutUrl });
      }
      // Prefer Stripe portal when linked; otherwise local plan change (admin-offered / free plans)
      if (current.stripe_subscription_id) {
        const portal = await createBillingPortalSession({
          stripeCustomerId: String(current.stripe_customer_id),
          returnPath: "/restaurant/subscriptions",
        });
        if (portal.ok) return NextResponse.json({ ok: true, portal_url: portal.portalUrl });
      }
      const result = await changeSubscriptionPlan(admin, current.id, planId, "partner_change");
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
