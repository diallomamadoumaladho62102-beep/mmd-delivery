import {
  isAmountVerificationFailure,
  type AmountVerificationResult,
} from "@/lib/verifyStripePaidAmount";
import {
  fromStripeAmount,
  normalizeTaxiCurrencyUpper,
} from "@/lib/taxiStripeAmounts";
import {
  requirePaymentIntentSucceeded,
  assertSettlementMatchesExpectation,
  type PaymentExpectation,
} from "@/lib/requirePaymentIntentSucceeded";

type TaxiRideAmountSource = {
  total_cents: number | null;
  currency: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_session_id?: string | null;
};

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
    expectation?: PaymentExpectation;
  }
): Promise<AmountVerificationResult> {
  const expectedCents = Math.round(Number(ride.total_cents ?? 0));
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const expectedCurrency = normalizeTaxiCurrencyUpper(ride.currency);

  // Single source of truth: only a succeeded PaymentIntent counts as paid.
  const settled = await requirePaymentIntentSucceeded({
    paymentIntentId: refs.paymentIntentId ?? ride.stripe_payment_intent_id ?? null,
    sessionId: refs.sessionId ?? ride.stripe_session_id ?? null,
  });

  if (!settled.ok) {
    return { ok: false, error: "stripe_not_paid" };
  }

  // Metadata policy (user / service_type / entity id). Amount & currency are
  // validated below with taxi minor-unit conversion, so they are not re-checked
  // here.
  if (refs.expectation) {
    const expectation = assertSettlementMatchesExpectation(
      settled,
      settled.metadata,
      refs.expectation
    );
    if (!expectation.ok) {
      return {
        ok: false,
        error: "metadata_mismatch",
        expected_currency: expectedCurrency,
        message: `${expectation.field}:${expectation.reason}`,
      };
    }
  }

  return compareTaxiPaidAmounts({
    expectedCents,
    expectedCurrency,
    stripeAmount: settled.amount_cents,
    stripeCurrency: settled.currency || expectedCurrency,
    paymentIntentId: settled.payment_intent_id,
    sessionId: settled.session_id,
  });
}

export { isAmountVerificationFailure };
