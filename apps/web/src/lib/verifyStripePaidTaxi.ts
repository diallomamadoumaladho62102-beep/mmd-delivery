import { stripe } from "@/lib/stripe";
import {
  isAmountVerificationFailure,
  type AmountVerificationResult,
} from "@/lib/verifyStripePaidAmount";

type TaxiRideAmountSource = {
  total_cents: number | null;
  currency: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_session_id?: string | null;
};

function normalizeCurrency(value: unknown): string {
  return String(value ?? "usd").trim().toLowerCase() || "usd";
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

export async function verifyStripePaidMatchesTaxiRide(
  ride: TaxiRideAmountSource,
  refs: {
    paymentIntentId?: string | null;
    sessionId?: string | null;
  }
): Promise<AmountVerificationResult> {
  const expectedCents = Number(ride.total_cents ?? 0);
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const expectedCurrency = normalizeCurrency(ride.currency);
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
      const actualCents = Math.round(Number(pi.amount ?? 0));
      const actualCurrency = normalizeCurrency(pi.currency);
      if (actualCents !== expectedCents) {
        return {
          ok: false,
          error: "amount_mismatch",
          expected_cents: expectedCents,
          actual_cents: actualCents,
          expected_currency: expectedCurrency,
          actual_currency: actualCurrency,
        };
      }
      if (actualCurrency !== expectedCurrency) {
        return {
          ok: false,
          error: "currency_mismatch",
          expected_currency: expectedCurrency,
          actual_currency: actualCurrency,
        };
      }
      return {
        ok: true,
        expected_cents: expectedCents,
        actual_cents: actualCents,
        currency: expectedCurrency,
        payment_intent_id: pi.id,
        session_id: sessionId,
      };
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
      const actualCents = Math.round(Number(session.amount_total ?? 0));
      const actualCurrency = normalizeCurrency(session.currency);
      if (actualCents !== expectedCents) {
        return {
          ok: false,
          error: "amount_mismatch",
          expected_cents: expectedCents,
          actual_cents: actualCents,
          expected_currency: expectedCurrency,
          actual_currency: actualCurrency,
        };
      }
      if (actualCurrency !== expectedCurrency) {
        return {
          ok: false,
          error: "currency_mismatch",
          expected_currency: expectedCurrency,
          actual_currency: actualCurrency,
        };
      }
      return {
        ok: true,
        expected_cents: expectedCents,
        actual_cents: actualCents,
        currency: expectedCurrency,
        payment_intent_id:
          paymentIntentIdFromUnknown(session.payment_intent) ?? null,
        session_id: session.id,
      };
    } catch {
      return { ok: false, error: "stripe_lookup_failed" };
    }
  }

  return { ok: false, error: "stripe_not_paid" };
}

export { isAmountVerificationFailure };
