import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  activateMmdPlus,
  cancelMmdPlus,
  invalidateMmdPlusCache,
} from "@/lib/mmdPlus/mmdPlusEngine";
import { mapMmdPlusStripeStatus } from "@/lib/mmdPlus/stripeMmdPlusBilling";
import { notifyMmdPlusEvent } from "@/lib/mmdPlus/mmdPlusNotifications";

function meta(obj: { metadata?: Stripe.Metadata | null } | null | undefined) {
  return obj?.metadata ?? {};
}

function isMmdPlusModule(metadata: Stripe.Metadata | null | undefined): boolean {
  return String(metadata?.mmd_module ?? "") === "mmd_plus";
}

async function alreadyProcessed(
  supabaseAdmin: SupabaseClient,
  stripeEventId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("mmd_plus_webhook_events")
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
  await supabaseAdmin.from("mmd_plus_webhook_events").upsert(
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
    .from("mmd_plus_plans")
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
  const userId = String(metadata.mmd_user_id ?? "").trim();
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const planId = await resolvePlanId(supabaseAdmin, metadata, priceId);

  if (!isMmdPlusModule(metadata) && !userId) {
    // May still be an update for an existing MMD+ row
    const { data: existing } = await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .select("id, user_id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (!existing) return { skipped: "not_mmd_plus" };

    const status = mapMmdPlusStripeStatus(sub.status);
    await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .update({
        status,
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
        renews: !sub.cancel_at_period_end && status !== "canceled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    invalidateMmdPlusCache(String(existing.user_id));

    if (status === "canceled") {
      await cancelMmdPlus(supabaseAdmin, String(existing.id), {
        atPeriodEnd: false,
        reason: "stripe_subscription_deleted",
      });
      await notifyMmdPlusEvent(supabaseAdmin, {
        userId: String(existing.user_id),
        event: "canceled",
      });
    }

    return { updated: true, subscription_id: existing.id, status };
  }

  if (!isMmdPlusModule(metadata)) {
    return { skipped: "not_mmd_plus" };
  }

  if (!userId || !planId) {
    return { skipped: "missing_user_or_plan", stripe_subscription_id: sub.id };
  }

  const status = mapMmdPlusStripeStatus(sub.status);
  const isTrial = status === "trialing";

  if (status === "canceled") {
    const { data: existing } = await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (existing?.id) {
      await cancelMmdPlus(supabaseAdmin, String(existing.id), {
        atPeriodEnd: false,
        reason: "stripe_canceled",
      });
      await notifyMmdPlusEvent(supabaseAdmin, { userId, event: "canceled" });
      return { canceled: true, subscription_id: existing.id };
    }
    return { skipped: "cancel_no_local_row" };
  }

  const result = await activateMmdPlus(supabaseAdmin, {
    userId,
    planId,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    isTrial,
    idempotencyKey: `mmd-plus-stripe:${sub.id}:${eventId}`,
    metadata: { stripe_status: sub.status, source: "stripe_webhook" },
  });

  if (result.subscription_id) {
    await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .update({
        status,
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        stripe_price_id: priceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(result.subscription_id));
  }

  const notifyEvent = isTrial
    ? "trial_started"
    : result.already_active
      ? "renewed"
      : "created";
  await notifyMmdPlusEvent(supabaseAdmin, { userId, event: notifyEvent });

  return { activated: true, ...result };
}

async function handleInvoice(
  supabaseAdmin: SupabaseClient,
  invoice: Stripe.Invoice,
  eventType: string
): Promise<Record<string, unknown>> {
  const subId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;
  if (!subId) return { skipped: "no_subscription_on_invoice" };

  const { data: local } = await supabaseAdmin
    .from("mmd_plus_subscriptions")
    .select("id, user_id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();

  if (!local) return { skipped: "not_mmd_plus_invoice" };

  const failed = eventType === "invoice.payment_failed";
  const paid = eventType === "invoice.paid" || eventType === "invoice.payment_succeeded";

  await supabaseAdmin.rpc("mmd_plus_record_invoice", {
    p_subscription_id: local.id,
    p_kind: "invoice",
    p_status: failed ? "failed" : paid ? "paid" : "open",
    p_amount_cents: invoice.amount_paid ?? invoice.amount_due ?? 0,
    p_currency: (invoice.currency ?? "usd").toUpperCase(),
    p_tax_cents: invoice.tax ?? 0,
    p_stripe_invoice_id: invoice.id,
    p_stripe_payment_intent_id:
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : invoice.payment_intent?.id ?? null,
    p_idempotency_key: `mmd-plus-inv:${invoice.id}:${eventType}`,
    p_description: invoice.description ?? eventType,
    p_period_start: invoice.period_start
      ? new Date(invoice.period_start * 1000).toISOString()
      : null,
    p_period_end: invoice.period_end
      ? new Date(invoice.period_end * 1000).toISOString()
      : null,
    p_metadata: { event_type: eventType },
  });

  if (failed) {
    await supabaseAdmin
      .from("mmd_plus_subscriptions")
      .update({ status: "past_due", updated_at: new Date().toISOString() })
      .eq("id", local.id);
    await notifyMmdPlusEvent(supabaseAdmin, {
      userId: String(local.user_id),
      event: "payment_failed",
    });
  } else if (paid) {
    await notifyMmdPlusEvent(supabaseAdmin, {
      userId: String(local.user_id),
      event: "payment_succeeded",
    });
  }

  return { recorded: true, subscription_id: local.id };
}

/**
 * Handle Stripe Billing events for MMD+.
 * Returns handled:false when the event is not an MMD+ event.
 */
export async function handleMmdPlusStripeEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
): Promise<{ handled: boolean; result?: Record<string, unknown> }> {
  try {
    if (await alreadyProcessed(supabaseAdmin, event.id)) {
      return { handled: true, result: { idempotent: true } };
    }

    let result: Record<string, unknown> = {};

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const metadata = meta(sub);
      const { data: existing } = await supabaseAdmin
        .from("mmd_plus_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();

      if (!isMmdPlusModule(metadata) && !existing) {
        return { handled: false };
      }

      result = await upsertFromStripeSubscription(supabaseAdmin, sub, event.id);
      await markProcessed(supabaseAdmin, event.id, event.type, event.data.object, result);
      return { handled: true, result };
    }

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed"
    ) {
      const invoice = event.data.object as Stripe.Invoice;
      result = await handleInvoice(supabaseAdmin, invoice, event.type);
      if (result.skipped === "not_mmd_plus_invoice" || result.skipped === "no_subscription_on_invoice") {
        return { handled: false };
      }
      await markProcessed(supabaseAdmin, event.id, event.type, event.data.object, result);
      return { handled: true, result };
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isMmdPlusModule(meta(session)) || session.mode !== "subscription") {
        return { handled: false };
      }

      const userId = String(session.metadata?.mmd_user_id ?? session.client_reference_id ?? "").trim();
      const planId = String(session.metadata?.mmd_plan_id ?? "").trim();
      const stripeSubId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;

      if (!userId || !planId) {
        result = { skipped: "missing_checkout_metadata" };
      } else {
        result = await activateMmdPlus(supabaseAdmin, {
          userId,
          planId,
          stripeSubscriptionId: stripeSubId,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : session.customer?.id,
          idempotencyKey: `mmd-plus-checkout:${session.id}`,
          metadata: { source: "checkout.session.completed" },
        });
        await notifyMmdPlusEvent(supabaseAdmin, { userId, event: "created" });
      }

      await markProcessed(supabaseAdmin, event.id, event.type, event.data.object, result);
      return { handled: true, result };
    }

    return { handled: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mmd-plus-webhook]", message);
    return { handled: true, result: { ok: false, error: message } };
  }
}
