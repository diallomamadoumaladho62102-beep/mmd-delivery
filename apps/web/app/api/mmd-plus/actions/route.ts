import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  cancelMmdPlus,
  changeMmdPlusPlan,
  getActiveMmdPlusSubscription,
  resumeMmdPlus,
} from "@/lib/mmdPlus/mmdPlusEngine";
import {
  createMmdPlusBillingPortalSession,
  createMmdPlusCheckoutSession,
} from "@/lib/mmdPlus/stripeMmdPlusBilling";
import { notifyMmdPlusEvent } from "@/lib/mmdPlus/mmdPlusNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const supabaseAdmin = auth.supabaseAdmin;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const userId = auth.user.id;
    const email = auth.user.email ?? null;

    if (action === "checkout") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return taxiJson({ ok: false, error: "Missing plan_id" }, 400);
      const result = await createMmdPlusCheckoutSession({
        supabaseAdmin,
        userId,
        planId,
        email,
      });
      if (result.ok === false) {
        return taxiJson({ ok: false, error: result.error, code: result.code }, 400);
      }
      return taxiJson({
        ok: true,
        checkout_url: result.checkoutUrl,
        session_id: result.sessionId,
      });
    }

    if (action === "portal") {
      const current = await getActiveMmdPlusSubscription(supabaseAdmin, userId);
      if (!current?.stripe_customer_id) {
        return taxiJson({ ok: false, error: "Aucun client Stripe lié" }, 400);
      }
      const result = await createMmdPlusBillingPortalSession({
        stripeCustomerId: current.stripe_customer_id,
      });
      if (result.ok === false) return taxiJson({ ok: false, error: result.error }, 400);
      return taxiJson({ ok: true, portal_url: result.portalUrl });
    }

    if (action === "cancel") {
      const current = await getActiveMmdPlusSubscription(supabaseAdmin, userId);
      if (!current) return taxiJson({ ok: false, error: "Aucun abonnement actif" }, 400);
      const result = await cancelMmdPlus(supabaseAdmin, current.id, {
        atPeriodEnd: body.at_period_end !== false,
        reason: typeof body.reason === "string" ? body.reason : "client_cancel",
      });
      await notifyMmdPlusEvent(supabaseAdmin, { userId, event: "canceled" });
      return taxiJson({ ok: true, result });
    }

    if (action === "resume") {
      const current = await getActiveMmdPlusSubscription(supabaseAdmin, userId);
      if (!current) return taxiJson({ ok: false, error: "Aucun abonnement" }, 400);
      const result = await resumeMmdPlus(supabaseAdmin, current.id);
      return taxiJson({ ok: true, result });
    }

    if (action === "change_plan") {
      const planId = String(body.plan_id ?? "").trim();
      if (!planId) return taxiJson({ ok: false, error: "Missing plan_id" }, 400);
      const current = await getActiveMmdPlusSubscription(supabaseAdmin, userId);
      if (!current) {
        const result = await createMmdPlusCheckoutSession({
          supabaseAdmin,
          userId,
          planId,
          email,
        });
        if (result.ok === false) {
          return taxiJson({ ok: false, error: result.error, code: result.code }, 400);
        }
        return taxiJson({ ok: true, checkout_url: result.checkoutUrl });
      }
      if (current.stripe_subscription_id && current.stripe_customer_id) {
        const portal = await createMmdPlusBillingPortalSession({
          stripeCustomerId: current.stripe_customer_id,
        });
        if (portal.ok) return taxiJson({ ok: true, portal_url: portal.portalUrl });
      }
      const result = await changeMmdPlusPlan(supabaseAdmin, current.id, planId, "client_change");
      await notifyMmdPlusEvent(supabaseAdmin, { userId, event: "plan_changed" });
      return taxiJson({ ok: true, result });
    }

    return taxiJson({ ok: false, error: "Unknown action" }, 400);
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
