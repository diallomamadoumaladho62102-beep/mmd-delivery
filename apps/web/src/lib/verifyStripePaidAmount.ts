import {
  normalizeCurrencyCode,
  resolveDeliveryRequestAmountCents,
  type DeliveryRequestAmountSource,
} from "@/lib/deliveryRequestAmountCents";
import { resolveOrderAmountCents, type OrderAmountSource } from "@/lib/orderAmountCents";
import { requirePaymentIntentSucceeded } from "@/lib/requirePaymentIntentSucceeded";

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
  // Single source of truth: a payment counts as paid only when the underlying
  // PaymentIntent has succeeded (a session's payment_status is never trusted on
  // its own). The amount/currency returned come from that settled PaymentIntent.
  const settled = await requirePaymentIntentSucceeded({
    paymentIntentId: params.paymentIntentId,
    sessionId: params.sessionId,
  });

  if (!settled.ok) {
    return { paid: false, reason: settled.reason };
  }

  return {
    paid: true,
    amount_cents: settled.amount_cents,
    currency: normalizeCurrencyCode(settled.currency),
    payment_intent_id: settled.payment_intent_id,
    session_id: settled.session_id,
  };
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
