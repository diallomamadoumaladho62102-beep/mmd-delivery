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
