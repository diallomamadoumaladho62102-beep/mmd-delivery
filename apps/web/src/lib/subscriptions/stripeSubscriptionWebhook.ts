import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  activateSubscription,
  cancelSubscription,
} from "@/lib/subscriptions/subscriptionEngine";
import { mapStripeSubscriptionStatus } from "@/lib/subscriptions/stripeBilling";

export const SUBSCRIPTION_STRIPE_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "checkout.session.completed",
] as const;

function meta(obj: { metadata?: Stripe.Metadata | null } | null | undefined) {
  return obj?.metadata ?? {};
}

function isSubscriptionModule(metadata: Stripe.Metadata | null | undefined): boolean {
  return String(metadata?.mmd_module ?? "") === "subscriptions";
}

async function alreadyProcessed(
  supabaseAdmin: SupabaseClient,
  stripeEventId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("subscription_webhook_events")
    .select("id")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  return Boolean(data?.id);
}

async function markProcessed(
  supabaseAdmin: SupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload: unknown,
  result: Record<string, unknown>
) {
  await supabaseAdmin.from("subscription_webhook_events").upsert(
    {
      stripe_event_id: stripeEventId,
      event_type: eventType,
      payload: payload as Record<string, unknown>,
      result,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "stripe_event_id" }
  );
}

async function resolvePlanId(
  supabaseAdmin: SupabaseClient,
  metadata: Stripe.Metadata,
  stripePriceId: string | null
): Promise<string | null> {
  const fromMeta = String(metadata.mmd_plan_id ?? "").trim();
  if (fromMeta) return fromMeta;
  if (!stripePriceId) return null;
  const { data } = await supabaseAdmin
    .from("subscription_plans")
    .select("id")
    .eq("stripe_price_id", stripePriceId)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function upsertFromStripeSubscription(
  supabaseAdmin: SupabaseClient,
  sub: Stripe.Subscription,
  eventId: string
): Promise<Record<string, unknown>> {
  const metadata = meta(sub);
  if (!isSubscriptionModule(metadata) && !String(sub.id ?? "").startsWith("sub_")) {
    return { skipped: "not_subscription_module" };
  }

  // Accept if metadata marks subscriptions OR we can resolve via price id.
  const partnerType = String(metadata.mmd_partner_type ?? "").trim() as
    | "restaurant"
    | "seller"
    | "driver"
    | "business";
  const partnerUserId = String(metadata.mmd_partner_user_id ?? "").trim();
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const planId = await resolvePlanId(supabaseAdmin, metadata, priceId);

  if (!partnerType || !partnerUserId || !planId) {
    // Try existing row by stripe_subscription_id for updates without metadata.
    const { data: existing } = await supabaseAdmin
      .from("partner_subscriptions")
      .select("id, partner_type, partner_user_id, plan_id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();

    if (!existing) {
      return { skipped: "missing_partner_or_plan", stripe_subscription_id: sub.id };
    }

    const status = mapStripeSubscriptionStatus(sub.status);
    const periodStart = sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : null;
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

    await supabaseAdmin
      .from("partner_subscriptions")
      .update({
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
        renews: !sub.cancel_at_period_end && status !== "canceled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (status === "canceled" || status === "expired") {
      await cancelSubscription(supabaseAdmin, String(existing.id), {
        atPeriodEnd: false,
        reason: "stripe_subscription_deleted",
      });
    }

    return { updated: true, subscription_id: existing.id, status };
  }

  if (!isSubscriptionModule(metadata)) {
    return { skipped: "not_subscription_module" };
  }

  const status = mapStripeSubscriptionStatus(sub.status);
  const isTrial = status === "trialing";

  if (status === "canceled") {
    const { data: existing } = await supabaseAdmin
      .from("partner_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (existing?.id) {
      await cancelSubscription(supabaseAdmin, String(existing.id), {
        atPeriodEnd: false,
        reason: "stripe_canceled",
      });
      return { canceled: true, subscription_id: existing.id };
    }
    return { skipped: "cancel_no_local_row" };
  }

  const result = await activateSubscription(supabaseAdmin, {
    partnerType,
    partnerUserId,
    planId,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    isTrial,
    idempotencyKey: `stripe-sub:${sub.id}:${eventId}`,
    metadata: {
      stripe_status: sub.status,
      source: "stripe_webhook",
    },
  });

  // Align period dates from Stripe
  if (result.subscription_id) {
    await supabaseAdmin
      .from("partner_subscriptions")
      .update({
        status,
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        trial_ends_at: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        stripe_price_id: priceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(result.subscription_id));
  }

  return { activated: true, ...result };
}

/**
 * Handle Stripe Billing events related to MMD subscriptions.
 * Idempotent via subscription_webhook_events.stripe_event_id.
 * Returns null when the event is not a subscriptions module event (caller continues).
 */
export async function handleSubscriptionStripeEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
): Promise<{ handled: boolean; result?: Record<string, unknown> }> {
  const type = event.type;

  // For checkout.session.completed, only handle subscription mode + our module.
  if (type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription" || !isSubscriptionModule(meta(session))) {
      return { handled: false };
    }
  } else if (
    type !== "customer.subscription.created" &&
    type !== "customer.subscription.updated" &&
    type !== "customer.subscription.deleted" &&
    type !== "invoice.paid" &&
    type !== "invoice.payment_failed" &&
    type !== "invoice.payment_succeeded"
  ) {
    return { handled: false };
  }

  // invoice.* without subscription module metadata may still belong to us if linked.
  if (type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice;
    const subId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id ?? null;
    if (!subId && !isSubscriptionModule(meta(invoice))) {
      return { handled: false };
    }
  }

  if (await alreadyProcessed(supabaseAdmin, event.id)) {
    return { handled: true, result: { already_processed: true } };
  }

  let result: Record<string, unknown> = {};

  try {
    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      result = await upsertFromStripeSubscription(supabaseAdmin, sub, event.id);
    } else if (type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = meta(session);
      const partnerType = String(metadata.mmd_partner_type ?? "") as
        | "restaurant"
        | "seller"
        | "driver"
        | "business";
      const partnerUserId = String(metadata.mmd_partner_user_id ?? "");
      const planId = String(metadata.mmd_plan_id ?? "");
      const stripeSubId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

      if (partnerType && partnerUserId && planId) {
        result = await activateSubscription(supabaseAdmin, {
          partnerType,
          partnerUserId,
          planId,
          stripeSubscriptionId: stripeSubId,
          stripeCustomerId: customerId,
          isTrial: false,
          idempotencyKey: `checkout:${session.id}`,
          metadata: { source: "checkout.session.completed" },
        });
      } else {
        result = { skipped: "missing_metadata" };
      }
    } else if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeSubId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id ?? null;

      if (stripeSubId) {
        const { data: sub } = await supabaseAdmin
          .from("partner_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", stripeSubId)
          .maybeSingle();

        if (sub?.id) {
          await supabaseAdmin.rpc("mmd_subscription_record_invoice", {
            p_subscription_id: sub.id,
            p_kind: "payment",
            p_status: "paid",
            p_amount_cents: invoice.amount_paid ?? invoice.amount_due ?? 0,
            p_currency: (invoice.currency ?? "usd").toUpperCase(),
            p_tax_cents: invoice.tax ?? 0,
            p_stripe_invoice_id: invoice.id,
            p_stripe_payment_intent_id:
              typeof invoice.payment_intent === "string"
                ? invoice.payment_intent
                : invoice.payment_intent?.id ?? null,
            p_idempotency_key: `invoice-paid:${invoice.id}`,
            p_description: invoice.description,
            p_period_start: invoice.period_start
              ? new Date(invoice.period_start * 1000).toISOString()
              : null,
            p_period_end: invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : null,
            p_metadata: { event_type: type },
          });

          await supabaseAdmin
            .from("partner_subscriptions")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("id", sub.id)
            .in("status", ["past_due", "incomplete", "trialing"]);

          result = { recorded: true, subscription_id: sub.id };
        } else {
          result = { skipped: "subscription_not_found" };
        }
      } else {
        result = { skipped: "no_subscription_on_invoice" };
      }
    } else if (type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeSubId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id ?? null;
      if (stripeSubId) {
        await supabaseAdmin
          .from("partner_subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", stripeSubId)
          .in("status", ["active", "trialing", "past_due"]);
        result = { marked_past_due: true };
      } else {
        result = { skipped: "no_subscription_on_invoice" };
      }
    }

    await markProcessed(supabaseAdmin, event.id, type, event.data.object, result);
    return { handled: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[subscriptions-webhook] handler failed", { type, eventId: event.id, message });
    await markProcessed(supabaseAdmin, event.id, type, event.data.object, {
      ok: false,
      error: message,
    });
    return { handled: true, result: { ok: false, error: message } };
  }
}

