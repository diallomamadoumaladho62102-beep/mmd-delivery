import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

/**
 * Single source of truth for "is this Stripe payment definitively successful?".
 *
 * Business rule (platform-wide): a payment is only considered definitively
 * successful when its underlying PaymentIntent has status === "succeeded".
 * A Checkout Session's `payment_status === "paid"` / `status === "complete"`
 * is NOT sufficient on its own — those fields can be set on a session whose
 * PaymentIntent is still processing, requires action, or (for async payment
 * methods) has not actually settled. Every "mark as paid" decision in the app
 * must resolve through this module.
 *
 * The only exception is a genuinely free checkout (amount_total === 0 with
 * `payment_status === "no_payment_required"`), which never produces a
 * PaymentIntent and is treated as settled with a null PaymentIntent id.
 */

export type PaymentSettlementResult =
  | {
      ok: true;
      /** null only for zero-amount `no_payment_required` sessions. */
      payment_intent_id: string | null;
      /** Amount in the smallest currency unit, as reported by Stripe. */
      amount_cents: number;
      /** Lowercase Stripe currency code (e.g. "usd", "gnf"). */
      currency: string;
      session_id: string | null;
      // Complementary optional so callers can read `.reason` on the union even
      // under tsconfig `strict: false` (where discriminant narrowing is loose).
      reason?: undefined;
    }
  | {
      ok: false;
      reason: string;
      payment_intent_id: string | null;
      session_id: string | null;
      amount_cents?: undefined;
      currency?: undefined;
    };

export function isPaymentSettlementFailure(
  result: PaymentSettlementResult
): result is Extract<PaymentSettlementResult, { ok: false }> {
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

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

type PaymentIntentLike = {
  id?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
};

type SessionLike = {
  id?: string | null;
  payment_status?: string | null;
  status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: unknown;
};

/**
 * Pure settlement evaluation from already-fetched Stripe objects (no network).
 * Exported so the rule can be unit-tested and reused by callers that already
 * hold expanded Stripe objects (e.g. signed webhook events).
 */
export function evaluateStripeSettlement(input: {
  paymentIntent?: PaymentIntentLike | null;
  session?: SessionLike | null;
}): PaymentSettlementResult {
  const sessionId = input.session?.id ? String(input.session.id) : null;

  const expandedFromSession =
    input.session &&
    typeof input.session.payment_intent === "object" &&
    input.session.payment_intent
      ? (input.session.payment_intent as PaymentIntentLike)
      : null;

  const pi = input.paymentIntent ?? expandedFromSession;

  if (pi) {
    const status = String(pi.status ?? "").toLowerCase();
    const piId = paymentIntentIdFromUnknown(pi.id);
    if (status !== "succeeded") {
      return {
        ok: false,
        reason: `payment_intent_status_${status || "unknown"}`,
        payment_intent_id: piId,
        session_id: sessionId,
      };
    }
    const amount = Number(pi.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        reason: "payment_intent_amount_missing",
        payment_intent_id: piId,
        session_id: sessionId,
      };
    }
    return {
      ok: true,
      payment_intent_id: piId,
      amount_cents: Math.round(amount),
      currency: String(pi.currency ?? "").toLowerCase() || "usd",
      session_id: sessionId,
    };
  }

  const session = input.session ?? null;
  if (session) {
    const payStatus = String(session.payment_status ?? "").toLowerCase();
    const amount = Number(session.amount_total ?? 0);

    // Genuinely free checkout — Stripe never creates a PaymentIntent for these.
    if (
      payStatus === "no_payment_required" &&
      (!Number.isFinite(amount) || amount === 0)
    ) {
      return {
        ok: true,
        payment_intent_id: null,
        amount_cents: 0,
        currency: String(session.currency ?? "").toLowerCase() || "usd",
        session_id: sessionId,
      };
    }

    // A paid/complete session whose PaymentIntent we could not resolve to
    // "succeeded" is explicitly NOT considered settled.
    return {
      ok: false,
      reason: `checkout_session_pi_unresolved_${payStatus || "unknown"}`,
      payment_intent_id: paymentIntentIdFromUnknown(session.payment_intent),
      session_id: sessionId,
    };
  }

  return {
    ok: false,
    reason: "missing_stripe_reference",
    payment_intent_id: null,
    session_id: null,
  };
}

/**
 * Resolve, from Stripe, whether a payment is definitively successful.
 *
 * Resolution order:
 *  1. An explicit PaymentIntent (object or id) — the strongest signal.
 *  2. The PaymentIntent attached to a Checkout Session (expanded, or retrieved
 *     by id). The session's own payment_status is never trusted on its own.
 */
export async function requirePaymentIntentSucceeded(refs: {
  paymentIntentId?: string | null;
  sessionId?: string | null;
  paymentIntent?: Stripe.PaymentIntent | null;
  session?: Stripe.Checkout.Session | null;
}): Promise<PaymentSettlementResult> {
  const piId = String(refs.paymentIntentId ?? "").trim() || null;
  const sessionId =
    String(refs.sessionId ?? refs.session?.id ?? "").trim() || null;

  if (refs.paymentIntent) {
    return evaluateStripeSettlement({
      paymentIntent: refs.paymentIntent,
      session: refs.session ?? null,
    });
  }

  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      return evaluateStripeSettlement({
        paymentIntent: pi,
        session: refs.session ?? null,
      });
    } catch (e) {
      return {
        ok: false,
        reason: errorMessage(e, "payment_intent_retrieve_failed"),
        payment_intent_id: piId,
        session_id: sessionId,
      };
    }
  }

  let session = refs.session ?? null;
  if (!session && sessionId) {
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });
    } catch (e) {
      return {
        ok: false,
        reason: errorMessage(e, "checkout_session_retrieve_failed"),
        payment_intent_id: null,
        session_id: sessionId,
      };
    }
  }

  if (!session) {
    return {
      ok: false,
      reason: "missing_stripe_reference",
      payment_intent_id: null,
      session_id: sessionId,
    };
  }

  const expanded =
    typeof session.payment_intent === "object" && session.payment_intent
      ? (session.payment_intent as Stripe.PaymentIntent)
      : null;
  const sessionPiId = paymentIntentIdFromUnknown(session.payment_intent);

  // Session carried only a PaymentIntent id (not expanded) — fetch it so we can
  // assert the real status rather than trusting session.payment_status.
  if (!expanded && sessionPiId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(sessionPiId);
      return evaluateStripeSettlement({ paymentIntent: pi, session });
    } catch (e) {
      return {
        ok: false,
        reason: errorMessage(e, "payment_intent_retrieve_failed"),
        payment_intent_id: sessionPiId,
        session_id: session.id ?? sessionId,
      };
    }
  }

  return evaluateStripeSettlement({ session });
}

// ---------------------------------------------------------------------------
// Expectation matching — the second half of the "definitively paid" gate.
//
// A succeeded PaymentIntent is necessary but not sufficient: before a resource
// is flipped to `paid` we must also confirm the settled money matches what the
// server expected for THIS resource, so a PaymentIntent belonging to another
// user / service / entity / quote / amount can never be replayed onto the
// wrong row (including a cross-service replay, e.g. a taxi PI onto an order).
//
// METADATA POLICY (versioned)
//   Every NEW PaymentIntent is stamped with `metadata_schema_version`
//   (see PAYMENT_METADATA_SCHEMA_VERSION) by its creator. The matcher keys its
//   strictness off that marker:
//     * VERSIONED metadata (new PIs): the business fields the caller declares
//       required (user, service_type, entity id) MUST be present AND match.
//       A missing required field BLOCKS the transition to paid.
//     * UNVERSIONED metadata (historical PIs minted before this policy): the
//       same fields are verified "if-present" only — a positive mismatch is
//       rejected, but a MISSING value is tolerated so PaymentIntents already in
//       circulation are never falsely rejected. This is a bounded, documented
//       backward-compatibility window, NOT the permanent rule.
//   amount / currency are always verified when the caller passes them (the
//   settled PaymentIntent always reports them, regardless of version).
//   quote_id is optional even on versioned PIs ("verify if the flow has one").
// ---------------------------------------------------------------------------

/**
 * Bump when the required-metadata contract changes. Written by every
 * PaymentIntent creator so settlement can tell a "new" PI (strict) apart from a
 * "historical" PI (tolerant). Presence — not the exact number — drives
 * strictness, so older versioned PIs stay strict too.
 */
export const PAYMENT_METADATA_SCHEMA_VERSION = "1";
const METADATA_VERSION_KEYS = ["metadata_schema_version", "metadataSchemaVersion"];

export type PaymentExpectation = {
  /** Expected amount in the smallest currency unit (Stripe minor units). */
  amountCents?: number | null;
  /** Expected ISO currency code (case-insensitive). */
  currency?: string | null;
  /** Expected owning user id (compared against metadata.user_id). */
  userId?: string | null;
  /** Expected service, e.g. "taxi" | "food" | "delivery" | "marketplace". */
  serviceType?: string | null;
  /** Expected business entity id (order/ride/request/seller_order id). */
  entityId?: string | null;
  /** Metadata keys that should carry `entityId` (creator-specific aliases). */
  entityIdKeys?: string[];
  /** Expected server quote id, when the flow is quote-first (optional). */
  quoteId?: string | null;
};

export type PaymentExpectationResult =
  | { ok: true; field?: undefined; reason?: undefined }
  | { ok: false; field: string; reason: string };

function metaValue(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const raw = metadata[key];
    if (raw != null) {
      const s = String(raw).trim();
      if (s) return s;
    }
  }
  return null;
}

export function isVersionedPaymentMetadata(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metaValue(metadata, METADATA_VERSION_KEYS) != null;
}

function matchMetaField(params: {
  field: string;
  expected: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  keys: string[];
  versioned: boolean;
  required: boolean;
  caseInsensitive?: boolean;
}): PaymentExpectationResult | null {
  const { field, expected, metadata, keys, versioned, required } = params;
  if (!expected || keys.length === 0) return null;

  const val = metaValue(metadata, keys);
  if (val == null) {
    // New (versioned) PI missing a required business field => hard block.
    if (versioned && required) {
      return {
        ok: false,
        field,
        reason: `metadata_${field}_missing_on_versioned_pi`,
      };
    }
    // Historical PI or optional field => tolerated (nothing to compare).
    return null;
  }

  const a = params.caseInsensitive ? val.toLowerCase() : val;
  const b = params.caseInsensitive
    ? String(expected).toLowerCase()
    : String(expected);
  if (a !== b) {
    return { ok: false, field, reason: `metadata_${field}_mismatch` };
  }
  return null;
}

/**
 * Verify a settled payment matches the server's expectation for a resource.
 * Pure (no network) so it is fully unit-testable and reusable across every
 * "mark as paid" path. Returns a structured, secret-free failure reason.
 */
export function assertSettlementMatchesExpectation(
  settled: PaymentSettlementResult,
  metadata: Record<string, unknown> | null | undefined,
  expected: PaymentExpectation
): PaymentExpectationResult {
  if (!settled.ok) {
    return { ok: false, field: "settlement", reason: settled.reason };
  }

  if (expected.amountCents != null && Number.isFinite(expected.amountCents)) {
    const want = Math.round(Number(expected.amountCents));
    if (settled.amount_cents !== want) {
      return {
        ok: false,
        field: "amount",
        reason: `amount_mismatch_${settled.amount_cents}_vs_${want}`,
      };
    }
  }

  if (expected.currency) {
    const want = String(expected.currency).toLowerCase();
    if (String(settled.currency).toLowerCase() !== want) {
      return {
        ok: false,
        field: "currency",
        reason: `currency_mismatch_${settled.currency}_vs_${want}`,
      };
    }
  }

  const versioned = isVersionedPaymentMetadata(metadata);

  const metaChecks: (PaymentExpectationResult | null)[] = [
    matchMetaField({
      field: "user",
      expected: expected.userId,
      metadata,
      keys: ["user_id", "userId", "client_user_id"],
      versioned,
      required: true,
    }),
    matchMetaField({
      field: "service_type",
      expected: expected.serviceType,
      metadata,
      keys: ["service_type", "serviceType", "module"],
      versioned,
      required: true,
      caseInsensitive: true,
    }),
    matchMetaField({
      field: "entity",
      expected: expected.entityId,
      metadata,
      keys: expected.entityIdKeys ?? [],
      versioned,
      required: true,
    }),
    matchMetaField({
      field: "quote",
      expected: expected.quoteId,
      metadata,
      keys: ["quote_id", "quoteId", "route_quote_id"],
      versioned,
      required: false,
    }),
  ];

  for (const result of metaChecks) {
    if (result) return result;
  }

  return { ok: true };
}
