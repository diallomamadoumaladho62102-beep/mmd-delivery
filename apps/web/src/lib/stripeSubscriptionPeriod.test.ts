import type Stripe from "stripe";
import {
  readStripeSubscriptionPeriod,
  stripePeriodEndIso,
  stripePeriodStartIso,
} from "./stripeSubscriptionPeriod";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("stripeSubscriptionPeriod tests");

const sub = {
  status: "active",
  cancel_at_period_end: true,
  canceled_at: 1_700_000_000,
  current_period_start: 1_700_000_100,
  current_period_end: 1_700_086_500,
} as Stripe.Subscription;

const period = readStripeSubscriptionPeriod(sub);
assert(period.currentPeriodStart === 1_700_000_100, "period start");
assert(period.currentPeriodEnd === 1_700_086_500, "period end");
assert(period.cancelAtPeriodEnd === true, "cancel at period end");
assert(stripePeriodStartIso(sub)?.includes("2023"), "start iso");

console.log("stripeSubscriptionPeriod tests passed");
