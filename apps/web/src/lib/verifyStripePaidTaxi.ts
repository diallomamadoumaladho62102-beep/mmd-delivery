import { stripe } from "@/lib/stripe";
import {
  isAmountVerificationFailure,
  type AmountVerificationResult,
} from "@/lib/verifyStripePaidAmount";
import {
  fromStripeAmount,
  normalizeTaxiCurrencyUpper,
} from "@/lib/taxiStripeAmounts";

type TaxiRideAmountSource = {
  total_cents: number | null;
  currency: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_session_id?: string | null;
};

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

function compareTaxiPaidAmounts(params: {
  expectedCents: number;
  expectedCurrency: string;
  stripeAmount: number;
  stripeCurrency: string;
  paymentIntentId?: string | null;
  sessionId?: string | null;
}): AmountVerificationResult {
  const actualCents = fromStripeAmount(
    params.expectedCurrency,
    params.stripeAmount
  );
  const actualCurrency = normalizeTaxiCurrencyUpper(params.stripeCurrency);

  if (actualCents !== params.expectedCents) {
    return {
      ok: false,
      error: "amount_mismatch",
      expected_cents: params.expectedCents,
      actual_cents: actualCents,
      expected_currency: params.expectedCurrency,
      actual_currency: actualCurrency,
    };
  }

  if (actualCurrency !== params.expectedCurrency) {
    return {
      ok: false,
      error: "currency_mismatch",
      expected_currency: params.expectedCurrency,
      actual_currency: actualCurrency,
    };
  }

  return {
    ok: true,
    expected_cents: params.expectedCents,
    actual_cents: actualCents,
    currency: params.expectedCurrency,
    payment_intent_id: params.paymentIntentId ?? null,
    session_id: params.sessionId ?? null,
  };
}

export async function verifyStripePaidMatchesTaxiRide(
  ride: TaxiRideAmountSource,
  refs: {
    paymentIntentId?: string | null;
    sessionId?: string | null;
  }
): Promise<AmountVerificationResult> {
  const expectedCents = Math.round(Number(ride.total_cents ?? 0));
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const expectedCurrency = normalizeTaxiCurrencyUpper(ride.currency);
  const piId =
    String(refs.paymentIntentId ?? ride.stripe_payment_intent_id ?? "").trim() ||
    null;
  const sessionId =
    String(refs.sessionId ?? ride.stripe_session_id ?? "").trim() || null;

  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.status !== "succeeded") {
        return { ok: false, error: "stripe_not_paid" };
      }
      return compareTaxiPaidAmounts({
        expectedCents,
        expectedCurrency,
        stripeAmount: Math.round(Number(pi.amount ?? 0)),
        stripeCurrency: String(pi.currency ?? expectedCurrency),
        paymentIntentId: pi.id,
        sessionId,
      });
    } catch {
      return { ok: false, error: "stripe_lookup_failed" };
    }
  }

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });
      if (String(session.payment_status ?? "").toLowerCase() !== "paid") {
        return { ok: false, error: "stripe_not_paid" };
      }
      return compareTaxiPaidAmounts({
        expectedCents,
        expectedCurrency,
        stripeAmount: Math.round(Number(session.amount_total ?? 0)),
        stripeCurrency: String(session.currency ?? expectedCurrency),
        paymentIntentId:
          paymentIntentIdFromUnknown(session.payment_intent) ?? null,
        sessionId: session.id,
      });
    } catch {
      return { ok: false, error: "stripe_lookup_failed" };
    }
  }

  return { ok: false, error: "stripe_not_paid" };
}

export { isAmountVerificationFailure };
