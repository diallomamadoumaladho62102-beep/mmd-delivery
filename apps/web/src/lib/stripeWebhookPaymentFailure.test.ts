import {
  isPaidLikePaymentStatus,
  isRefundedLikeRow,
  isStripeReferenceCompatible,
  shouldApplyPaymentFailureUpdate,
  STRIPE_WEBHOOK_FAILURE_EVENT_TYPES,
} from "./stripeWebhookPaymentFailure";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(isPaidLikePaymentStatus("paid"), "paid is terminal");
assert(isPaidLikePaymentStatus("refunded"), "refunded is terminal");
assert(!isPaidLikePaymentStatus("unpaid"), "unpaid is not terminal");

assert(
  isRefundedLikeRow({
    payment_status: "paid",
    refund_status: null,
    stripe_refund_id: null,
  }),
  "paid row is refunded-like",
);

assert(
  isRefundedLikeRow({
    payment_status: "unpaid",
    refund_status: "refunded",
    stripe_refund_id: null,
  }),
  "refund_status refunded blocks update",
);

assert(
  isStripeReferenceCompatible("cs_123", "cs_123"),
  "matching session refs compatible",
);
assert(
  isStripeReferenceCompatible(null, "cs_123"),
  "empty existing session accepts incoming",
);
assert(
  !isStripeReferenceCompatible("cs_old", "cs_new"),
  "conflicting session refs incompatible",
);

const eligible = shouldApplyPaymentFailureUpdate({
  payment_status: "unpaid",
  refund_status: null,
  stripe_refund_id: null,
  stripe_session_id: "cs_1",
  stripe_payment_intent_id: null,
  incoming_session_id: "cs_1",
  incoming_payment_intent_id: "pi_1",
});
assert(eligible.apply, "unpaid row with matching refs is eligible");
assert(eligible.reason === "eligible", "eligible reason");

const paidSkip = shouldApplyPaymentFailureUpdate({
  payment_status: "paid",
  refund_status: null,
  stripe_refund_id: null,
  incoming_session_id: "cs_1",
});
assert(!paidSkip.apply, "paid rows are skipped");
assert(
  paidSkip.reason === "already_paid_or_refunded",
  "paid skip reason",
);

const sessionMismatch = shouldApplyPaymentFailureUpdate({
  payment_status: "unpaid",
  stripe_session_id: "cs_a",
  incoming_session_id: "cs_b",
});
assert(!sessionMismatch.apply, "session mismatch blocks update");
assert(sessionMismatch.reason === "session_mismatch", "session mismatch reason");

assert(
  STRIPE_WEBHOOK_FAILURE_EVENT_TYPES.includes("checkout.session.expired"),
  "expired event tracked",
);
assert(
  STRIPE_WEBHOOK_FAILURE_EVENT_TYPES.includes("payment_intent.payment_failed"),
  "payment_failed event tracked",
);

console.log("stripeWebhookPaymentFailure tests passed");
