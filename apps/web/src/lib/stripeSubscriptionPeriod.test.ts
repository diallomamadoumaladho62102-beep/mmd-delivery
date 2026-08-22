import type Stripe from "stripe";
import {
  readStripeInvoicePaymentIntentId,
  readStripeInvoiceSubscriptionId,
  readStripeInvoiceTaxCents,
  readStripeSubscriptionPeriod,
  stripePeriodEndIso,
  stripePeriodStartIso,
} from "./stripeSubscriptionPeriod";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("stripeSubscriptionPeriod tests");

const sub = {
  status: "active" as const,
  cancel_at_period_end: true,
  canceled_at: 1_700_000_000,
  current_period_start: 1_700_000_100,
  current_period_end: 1_700_086_500,
} as unknown as Stripe.Subscription;

const period = readStripeSubscriptionPeriod(sub);
assert(period.currentPeriodStart === 1_700_000_100, "period start");
assert(period.currentPeriodEnd === 1_700_086_500, "period end");
assert(period.cancelAtPeriodEnd === true, "cancel at period end");
assert(stripePeriodStartIso(sub)?.includes("2023"), "start iso");

const invoice = {
  subscription: "sub_test_1",
  tax: 42,
  payment_intent: "pi_test_1",
} as unknown as Stripe.Invoice;
assert(
  readStripeInvoiceSubscriptionId(invoice) === "sub_test_1",
  "invoice subscription id",
);
assert(readStripeInvoiceTaxCents(invoice) === 42, "invoice tax cents");
assert(
  readStripeInvoicePaymentIntentId(invoice) === "pi_test_1",
  "invoice payment intent id",
);

console.log("stripeSubscriptionPeriod tests passed");
