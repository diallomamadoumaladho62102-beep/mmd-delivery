import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import type { SubscriptionPartnerType } from "@/lib/subscriptions/subscriptionEngine";

/**
 * Stripe Billing integration — prepared architecture.
 *
 * Products/Prices are linked via subscription_plans.stripe_product_id /
 * stripe_price_id. When those IDs are not yet provisioned in Stripe, helpers
 * return a clear error so portals can show "paiement bientôt disponible"
 * without hardcoding secrets or price IDs.
 */

export type SubscriptionCheckoutResult =
  | { ok: true; checkoutUrl: string; sessionId: string }
  | { ok: false; error: string; code?: string };

export type SubscriptionPortalResult =
  | { ok: true; portalUrl: string }
  | { ok: false; error: string; code?: string };

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://www.mmddelivery.com"
  ).replace(/\/$/, "");
}

export async function ensureStripeCustomer(params: {
  supabaseAdmin: SupabaseClient;
  partnerType: SubscriptionPartnerType;
  partnerUserId: string;
  email?: string | null;
  existingCustomerId?: string | null;
}): Promise<string> {
  if (params.existingCustomerId) return params.existingCustomerId;

  const customer = await stripe.customers.create({
    email: params.email ?? undefined,
    metadata: {
      mmd_partner_type: params.partnerType,
      mmd_partner_user_id: params.partnerUserId,
      mmd_module: "subscriptions",
    },
  });
  return customer.id;
}

/**
 * Create a Stripe Checkout Session in subscription mode for a plan.
 * Requires subscription_plans.stripe_price_id to be set by admin.
 */
export async function createSubscriptionCheckoutSession(params: {
  supabaseAdmin: SupabaseClient;
  partnerType: SubscriptionPartnerType;
  partnerUserId: string;
  planId: string;
  email?: string | null;
  successPath?: string;
  cancelPath?: string;
}): Promise<SubscriptionCheckoutResult> {
  const { data: plan, error } = await params.supabaseAdmin
    .from("subscription_plans")
    .select("*")
    .eq("id", params.planId)
    .eq("partner_type", params.partnerType)
    .eq("status", "active")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!plan) return { ok: false, error: "plan_not_found", code: "plan_not_found" };

  const priceId = String(plan.stripe_price_id ?? "").trim();
  if (!priceId) {
    return {
      ok: false,
      error: "Stripe Price non configuré pour ce plan",
      code: "stripe_price_missing",
    };
  }

  // Reuse customer from any prior subscription row when present.
  const { data: prior } = await params.supabaseAdmin
    .from("partner_subscriptions")
    .select("stripe_customer_id")
    .eq("partner_type", params.partnerType)
    .eq("partner_user_id", params.partnerUserId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const customerId = await ensureStripeCustomer({
    supabaseAdmin: params.supabaseAdmin,
    partnerType: params.partnerType,
    partnerUserId: params.partnerUserId,
    email: params.email,
    existingCustomerId: prior?.stripe_customer_id ? String(prior.stripe_customer_id) : null,
  });

  const base = appBaseUrl();
  const successPath =
    params.successPath ??
    (params.partnerType === "seller" ? "/seller/subscriptions?ok=1" : "/restaurant/subscriptions?ok=1");
  const cancelPath =
    params.cancelPath ??
    (params.partnerType === "seller" ? "/seller/subscriptions?canceled=1" : "/restaurant/subscriptions?canceled=1");

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}${successPath}`,
    cancel_url: `${base}${cancelPath}`,
    client_reference_id: params.partnerUserId,
    metadata: {
      mmd_module: "subscriptions",
      mmd_partner_type: params.partnerType,
      mmd_partner_user_id: params.partnerUserId,
      mmd_plan_id: params.planId,
    },
    subscription_data: {
      metadata: {
        mmd_module: "subscriptions",
        mmd_partner_type: params.partnerType,
        mmd_partner_user_id: params.partnerUserId,
        mmd_plan_id: params.planId,
      },
      trial_period_days:
        plan.trial_enabled && Number(plan.trial_days) > 0 ? Number(plan.trial_days) : undefined,
    },
    allow_promotion_codes: true,
  };

  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url) {
    return { ok: false, error: "checkout_session_missing_url", code: "checkout_failed" };
  }

  return { ok: true, checkoutUrl: session.url, sessionId: session.id };
}

/** Stripe Customer Portal for plan changes / payment method / cancel. */
export async function createBillingPortalSession(params: {
  stripeCustomerId: string;
  returnPath: string;
}): Promise<SubscriptionPortalResult> {
  if (!params.stripeCustomerId) {
    return { ok: false, error: "missing_customer", code: "missing_customer" };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: `${appBaseUrl()}${params.returnPath}`,
  });
  return { ok: true, portalUrl: session.url };
}

/**
 * Map a Stripe subscription status to our partner_subscriptions.status.
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status | string
): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "past_due";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return "incomplete";
  }
}
