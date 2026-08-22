import type Stripe from "stripe";

/** Period fields still returned by Stripe API; cast keeps TS when Dependabot bumps stripe major. */
export type StripeSubscriptionPeriod = {
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
};

export function readStripeSubscriptionPeriod(
  sub: Stripe.Subscription,
): StripeSubscriptionPeriod {
  const legacy = sub as Stripe.Subscription & {
    current_period_start?: number | null;
    current_period_end?: number | null;
  };
  return {
    currentPeriodStart: legacy.current_period_start ?? null,
    currentPeriodEnd: legacy.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: sub.canceled_at ?? null,
  };
}

export function stripePeriodStartIso(sub: Stripe.Subscription): string | null {
  const { currentPeriodStart } = readStripeSubscriptionPeriod(sub);
  return currentPeriodStart
    ? new Date(currentPeriodStart * 1000).toISOString()
    : null;
}

export function stripePeriodEndIso(sub: Stripe.Subscription): string | null {
  const { currentPeriodEnd } = readStripeSubscriptionPeriod(sub);
  return currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toISOString()
    : null;
}

export function readStripeInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | null {
  const legacy = invoice as StripeInvoiceLegacy;
  const sub = legacy.subscription;
  if (typeof sub === "string") return sub.trim() || null;
  return sub?.id ? String(sub.id) : null;
}

type StripeInvoiceLegacy = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
  tax?: number | null;
  payment_intent?: string | Stripe.PaymentIntent | null;
};

export function readStripeInvoiceTaxCents(invoice: Stripe.Invoice): number {
  const legacy = invoice as StripeInvoiceLegacy;
  return Math.max(0, Math.round(Number(legacy.tax ?? 0)));
}

export function readStripeInvoicePaymentIntentId(
  invoice: Stripe.Invoice,
): string | null {
  const legacy = invoice as StripeInvoiceLegacy;
  const pi = legacy.payment_intent;
  if (typeof pi === "string") return pi.trim() || null;
  return pi?.id ? String(pi.id) : null;
}
