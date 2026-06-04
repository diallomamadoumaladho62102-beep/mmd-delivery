import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  normalizeCurrencyCode,
  resolveDeliveryRequestAmountCents,
  type DeliveryRequestAmountSource,
} from "@/lib/deliveryRequestAmountCents";
import { resolveOrderAmountCents, type OrderAmountSource } from "@/lib/orderAmountCents";

export type AmountVerificationResult =
  | {
      ok: true;
      expected_cents: number;
      actual_cents: number;
      currency: string;
      payment_intent_id: string | null;
      session_id: string | null;
    }
  | {
      ok: false;
      error:
        | "missing_expected_amount"
        | "stripe_not_paid"
        | "amount_mismatch"
        | "currency_mismatch"
        | "stripe_lookup_failed";
      expected_cents?: number | null;
      actual_cents?: number | null;
      expected_currency?: string;
      actual_currency?: string | null;
      message?: string;
    };

export type AmountVerificationFailure = Extract<
  AmountVerificationResult,
  { ok: false }
>;

export function isAmountVerificationFailure(
  result: AmountVerificationResult
): result is AmountVerificationFailure {
  return result.ok === false;
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

function readStripeAmountCents(
  source: "payment_intent" | "checkout_session",
  obj: Stripe.PaymentIntent | Stripe.Checkout.Session
): number | null {
  if (source === "payment_intent") {
    const pi = obj as Stripe.PaymentIntent;
    if (Number.isFinite(pi.amount) && pi.amount > 0) return Math.round(pi.amount);
    return null;
  }

  const session = obj as Stripe.Checkout.Session;
  if (Number.isFinite(session.amount_total) && session.amount_total > 0) {
    return Math.round(session.amount_total);
  }
  return null;
}

function readStripeCurrency(
  source: "payment_intent" | "checkout_session",
  obj: Stripe.PaymentIntent | Stripe.Checkout.Session
): string | null {
  if (source === "payment_intent") {
    return normalizeCurrencyCode((obj as Stripe.PaymentIntent).currency);
  }
  return normalizeCurrencyCode((obj as Stripe.Checkout.Session).currency);
}

type PaidStripeAmountResult =
  | {
      paid: true;
      amount_cents: number;
      currency: string;
      payment_intent_id: string | null;
      session_id: string | null;
    }
  | { paid: false; reason: string };

type StripePaidAmountFailure = Extract<PaidStripeAmountResult, { paid: false }>;

function isStripePaidAmountFailure(
  result: PaidStripeAmountResult
): result is StripePaidAmountFailure {
  return result.paid === false;
}

async function loadPaidStripeAmount(params: {
  paymentIntentId?: string | null;
  sessionId?: string | null;
}): Promise<PaidStripeAmountResult> {
  const piId = String(params.paymentIntentId ?? "").trim();
  const sessionId = String(params.sessionId ?? "").trim();

  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.status !== "succeeded") {
        return { paid: false, reason: `payment_intent_status_${pi.status}` };
      }
      const amount = readStripeAmountCents("payment_intent", pi);
      if (amount == null) {
        return { paid: false, reason: "payment_intent_amount_missing" };
      }
      return {
        paid: true,
        amount_cents: amount,
        currency: readStripeCurrency("payment_intent", pi) ?? "usd",
        payment_intent_id: pi.id,
        session_id: sessionId || null,
      };
    } catch (e) {
      return {
        paid: false,
        reason: e instanceof Error ? e.message : "payment_intent_retrieve_failed",
      };
    }
  }

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      const paymentStatus = String(session.payment_status ?? "").toLowerCase();
      const sessionStatus = String(session.status ?? "").toLowerCase();
      const paid =
        paymentStatus === "paid" || sessionStatus === "complete";

      if (!paid) {
        return {
          paid: false,
          reason: `checkout_session_not_paid_${paymentStatus || sessionStatus}`,
        };
      }

      const amount = readStripeAmountCents("checkout_session", session);
      if (amount == null) {
        return { paid: false, reason: "checkout_session_amount_missing" };
      }

      const sessionPiId =
        paymentIntentIdFromUnknown(session.payment_intent) ?? null;

      return {
        paid: true,
        amount_cents: amount,
        currency: readStripeCurrency("checkout_session", session) ?? "usd",
        payment_intent_id: sessionPiId,
        session_id: session.id,
      };
    } catch (e) {
      return {
        paid: false,
        reason: e instanceof Error ? e.message : "checkout_session_retrieve_failed",
      };
    }
  }

  return { paid: false, reason: "missing_stripe_reference" };
}

export async function verifyStripePaidMatchesDeliveryRequest(
  deliveryRequest: DeliveryRequestAmountSource & {
    stripe_payment_intent_id?: string | null;
    stripe_session_id?: string | null;
  },
  opts?: { paymentIntentId?: string | null; sessionId?: string | null }
): Promise<AmountVerificationResult> {
  const expectedCents = resolveDeliveryRequestAmountCents(deliveryRequest);
  const expectedCurrency = normalizeCurrencyCode(deliveryRequest.currency);

  if (expectedCents == null) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const stripePaid = await loadPaidStripeAmount({
    paymentIntentId:
      opts?.paymentIntentId ??
      deliveryRequest.stripe_payment_intent_id ??
      null,
    sessionId:
      opts?.sessionId ?? deliveryRequest.stripe_session_id ?? null,
  });

  if (isStripePaidAmountFailure(stripePaid)) {
    return {
      ok: false,
      error: "stripe_not_paid",
      message: stripePaid.reason,
      expected_cents: expectedCents,
    };
  }

  if (stripePaid.amount_cents !== expectedCents) {
    return {
      ok: false,
      error: "amount_mismatch",
      expected_cents: expectedCents,
      actual_cents: stripePaid.amount_cents,
      expected_currency: expectedCurrency,
      actual_currency: stripePaid.currency,
    };
  }

  if (stripePaid.currency !== expectedCurrency) {
    return {
      ok: false,
      error: "currency_mismatch",
      expected_cents: expectedCents,
      actual_cents: stripePaid.amount_cents,
      expected_currency: expectedCurrency,
      actual_currency: stripePaid.currency,
    };
  }

  return {
    ok: true,
    expected_cents: expectedCents,
    actual_cents: stripePaid.amount_cents,
    currency: expectedCurrency,
    payment_intent_id: stripePaid.payment_intent_id,
    session_id: stripePaid.session_id,
  };
}

export async function verifyStripePaidMatchesOrder(
  order: OrderAmountSource & {
    currency?: unknown;
    stripe_payment_intent_id?: string | null;
    stripe_session_id?: string | null;
  },
  opts?: { paymentIntentId?: string | null; sessionId?: string | null }
): Promise<AmountVerificationResult> {
  const expectedCents = resolveOrderAmountCents(order);
  const expectedCurrency = normalizeCurrencyCode(order.currency);

  if (expectedCents == null) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const stripePaid = await loadPaidStripeAmount({
    paymentIntentId:
      opts?.paymentIntentId ?? order.stripe_payment_intent_id ?? null,
    sessionId: opts?.sessionId ?? order.stripe_session_id ?? null,
  });

  if (isStripePaidAmountFailure(stripePaid)) {
    return {
      ok: false,
      error: "stripe_not_paid",
      message: stripePaid.reason,
      expected_cents: expectedCents,
    };
  }

  if (stripePaid.amount_cents !== expectedCents) {
    return {
      ok: false,
      error: "amount_mismatch",
      expected_cents: expectedCents,
      actual_cents: stripePaid.amount_cents,
      expected_currency: expectedCurrency,
      actual_currency: stripePaid.currency,
    };
  }

  if (stripePaid.currency !== expectedCurrency) {
    return {
      ok: false,
      error: "currency_mismatch",
      expected_cents: expectedCents,
      actual_cents: stripePaid.amount_cents,
      expected_currency: expectedCurrency,
      actual_currency: stripePaid.currency,
    };
  }

  return {
    ok: true,
    expected_cents: expectedCents,
    actual_cents: stripePaid.amount_cents,
    currency: expectedCurrency,
    payment_intent_id: stripePaid.payment_intent_id,
    session_id: stripePaid.session_id,
  };
}
