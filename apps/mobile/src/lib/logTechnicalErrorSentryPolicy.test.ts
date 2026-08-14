import assert from "node:assert/strict";
import { isExpectedUnpaidPaymentSentryNoise } from "./taxiPaymentAbandonFlow";
import { toCapturableError } from "./toCapturableError";

/**
 * Policy: expected unpaid confirm-taxi-paid (HTTP 409) must not become a
 * CapturedObjectError / Sentry Error. Real failures must still normalize + capture.
 */

const unpaid409 = {
  ok: false,
  error: "Stripe payment not confirmed yet",
  payment_status: "unpaid",
};

assert.equal(isExpectedUnpaidPaymentSentryNoise(unpaid409, { status: 409 }), true);

// What old buggy path sent to Sentry (plain API body → CapturedObjectError).
const capturable = toCapturableError(unpaid409, "taxi.post/api/stripe/client/confirm-taxi-paid");
assert.equal(capturable.name, "CapturedObjectError");
assert.match(capturable.message, /Stripe payment not confirmed yet/i);
assert.equal(
  isExpectedUnpaidPaymentSentryNoise(capturable, { status: 409 }),
  true,
  "normalized CapturedObjectError for unpaid 409 must still be filtered",
);

// Real server error: still capturable and NOT filtered.
const serverFail = { error: "Stripe webhook secret missing" };
const serverErr = toCapturableError(serverFail, "taxi.post/confirm-taxi-paid");
assert.equal(serverErr.message.includes("webhook"), true);
assert.equal(isExpectedUnpaidPaymentSentryNoise(serverFail, { status: 500 }), false);
assert.equal(isExpectedUnpaidPaymentSentryNoise(serverErr, { status: 500 }), false);

console.log("logTechnicalErrorSentryPolicy.test.ts OK");
