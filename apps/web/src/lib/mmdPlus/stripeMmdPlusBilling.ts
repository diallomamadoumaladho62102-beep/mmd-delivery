import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

export type MmdPlusCheckoutResult =
  | { ok: true; checkoutUrl: string; sessionId: string }
  | { ok: false; error: string; code?: string };

export type MmdPlusPortalResult =
  | { ok: true; portalUrl: string }
  | { ok: false; error: string; code?: string };

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://www.mmddelivery.com"
  ).replace(/\/$/, "");
}

export async function ensureMmdPlusStripeCustomer(params: {
  userId: string;
  email?: string | null;
  existingCustomerId?: string | null;
}): Promise<string> {
  if (params.existingCustomerId) return params.existingCustomerId;

  const customer = await stripe.customers.create({
    email: params.email ?? undefined,
    metadata: {
      mmd_module: "mmd_plus",
      mmd_user_id: params.userId,
    },
  });
  return customer.id;
}

/**
 * Stripe Checkout in subscription mode for MMD+.
 * Requires mmd_plus_plans.stripe_price_id configured by admin.
 */
export async function createMmdPlusCheckoutSession(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  planId: string;
  email?: string | null;
  successPath?: string;
  cancelPath?: string;
}): Promise<MmdPlusCheckoutResult> {
  const { data: plan, error } = await params.supabaseAdmin
    .from("mmd_plus_plans")
    .select("*")
    .eq("id", params.planId)
    .eq("status", "active")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!plan) return { ok: false, error: "plan_not_found", code: "plan_not_found" };

  const priceId = String(plan.stripe_price_id ?? "").trim();
  if (!priceId) {
    return {
      ok: false,
      error: "Stripe Price non configuré pour ce plan MMD+",
      code: "stripe_price_missing",
    };
  }

  const { data: prior } = await params.supabaseAdmin
    .from("mmd_plus_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", params.userId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const customerId = await ensureMmdPlusStripeCustomer({
    userId: params.userId,
    email: params.email,
    existingCustomerId: prior?.stripe_customer_id ? String(prior.stripe_customer_id) : null,
  });

  const base = appBaseUrl();
  const successPath = params.successPath ?? "/mmd-plus?ok=1";
  const cancelPath = params.cancelPath ?? "/mmd-plus?canceled=1";

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}${successPath}`,
    cancel_url: `${base}${cancelPath}`,
    client_reference_id: params.userId,
    metadata: {
      mmd_module: "mmd_plus",
      mmd_user_id: params.userId,
      mmd_plan_id: params.planId,
    },
    subscription_data: {
      metadata: {
        mmd_module: "mmd_plus",
        mmd_user_id: params.userId,
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

export async function createMmdPlusBillingPortalSession(params: {
  stripeCustomerId: string;
  returnPath?: string;
}): Promise<MmdPlusPortalResult> {
  if (!params.stripeCustomerId) {
    return { ok: false, error: "missing_customer", code: "missing_customer" };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: `${appBaseUrl()}${params.returnPath ?? "/mmd-plus"}`,
  });
  return { ok: true, portalUrl: session.url };
}

export function mapMmdPlusStripeStatus(status: Stripe.Subscription.Status | string): string {
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
