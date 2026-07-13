import assert from "node:assert/strict";
import {
  evaluateStripeSettlement,
  assertSettlementMatchesExpectation,
  type PaymentSettlementResult,
} from "./requirePaymentIntentSucceeded";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

// A succeeded PaymentIntent is the canonical "definitively paid" signal.
test("succeeded PaymentIntent settles with amount + currency", () => {
  const r = evaluateStripeSettlement({
    paymentIntent: { id: "pi_1", status: "succeeded", amount: 1299, currency: "USD" },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, "pi_1");
    assert.equal(r.amount_cents, 1299);
    assert.equal(r.currency, "usd");
  }
});

test("non-succeeded PaymentIntent is NOT settled", () => {
  for (const status of [
    "requires_payment_method",
    "requires_action",
    "processing",
    "requires_capture",
    "canceled",
  ]) {
    const r = evaluateStripeSettlement({
      paymentIntent: { id: "pi_x", status, amount: 1000, currency: "usd" },
    });
    assert.equal(r.ok, false, `status ${status} must not settle`);
    if (!r.ok) assert.equal(r.reason, `payment_intent_status_${status}`);
  }
});

test("succeeded PaymentIntent with non-positive amount is rejected", () => {
  const r = evaluateStripeSettlement({
    paymentIntent: { id: "pi_0", status: "succeeded", amount: 0, currency: "usd" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "payment_intent_amount_missing");
});

// The core hardening: a PAID session alone is not enough — the PaymentIntent must succeed.
test("session payment_status=paid WITHOUT a succeeded PI is NOT settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_1",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: "pi_unresolved",
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "checkout_session_pi_unresolved_paid");
    assert.equal(r.payment_intent_id, "pi_unresolved");
  }
});

test("session with expanded succeeded PI settles", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_2",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: { id: "pi_2", status: "succeeded", amount: 5000, currency: "usd" },
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, "pi_2");
    assert.equal(r.amount_cents, 5000);
    assert.equal(r.session_id, "cs_2");
  }
});

test("session with expanded non-succeeded PI is NOT settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_3",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: { id: "pi_3", status: "requires_action", amount: 5000, currency: "usd" },
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "payment_intent_status_requires_action");
});

// Genuinely free checkout (no PaymentIntent) is the only PI-less settled case.
test("free no_payment_required session settles with null PI", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_free",
      payment_status: "no_payment_required",
      status: "complete",
      amount_total: 0,
      currency: "usd",
      payment_intent: null,
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, null);
    assert.equal(r.amount_cents, 0);
  }
});

test("no_payment_required with a positive amount is NOT auto-settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_weird",
      payment_status: "no_payment_required",
      status: "complete",
      amount_total: 1000,
      currency: "usd",
      payment_intent: null,
    },
  });
  assert.equal(r.ok, false);
});

test("missing references are not settled", () => {
  const r = evaluateStripeSettlement({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "missing_stripe_reference");
});

// ---------------------------------------------------------------------------
// assertSettlementMatchesExpectation — amount / currency / user / service /
// quote matching on top of a succeeded settlement.
// ---------------------------------------------------------------------------

const settledOk: PaymentSettlementResult = {
  ok: true,
  payment_intent_id: "pi_ok",
  amount_cents: 1500,
  currency: "usd",
  session_id: "cs_ok",
  metadata: null,
};

test("expectation: a non-settled payment always fails, carrying the reason", () => {
  const notSettled: PaymentSettlementResult = {
    ok: false,
    reason: "payment_intent_status_processing",
    payment_intent_id: "pi_p",
    session_id: null,
  };
  const r = assertSettlementMatchesExpectation(notSettled, {}, {});
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.field, "settlement");
    assert.equal(r.reason, "payment_intent_status_processing");
  }
});

test("expectation: matching amount + currency passes", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { user_id: "u1", module: "taxi", quote_id: "q1" },
    { amountCents: 1500, currency: "USD", userId: "u1", serviceType: "taxi", quoteId: "q1" }
  );
  assert.equal(r.ok, true);
});

test("expectation: wrong amount is rejected", () => {
  const r = assertSettlementMatchesExpectation(settledOk, {}, { amountCents: 1499 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "amount");
});

test("expectation: wrong currency is rejected", () => {
  const r = assertSettlementMatchesExpectation(settledOk, {}, { currency: "eur" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "currency");
});

test("expectation: wrong user in metadata is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { user_id: "attacker" },
    { userId: "victim" }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "user");
});

test("expectation: wrong service_type in metadata is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { module: "marketplace" },
    { serviceType: "taxi" }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "service_type");
});

test("expectation: wrong quote_id in metadata is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { quote_id: "q_other" },
    { quoteId: "q_expected" }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "quote");
});

test("expectation: HISTORICAL (unversioned) PI missing metadata is tolerated", () => {
  // Legacy PaymentIntents created before the metadata policy must not be
  // falsely rejected — only a POSITIVE mismatch blocks the transition to paid.
  const res = assertSettlementMatchesExpectation(settledOk, {}, {
    userId: "u1",
    serviceType: "taxi",
    entityId: "e1",
    entityIdKeys: ["taxi_ride_id"],
  });
  assert.equal(res.ok, true);
});

test("expectation: user match via client_user_id metadata alias", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { client_user_id: "u1" },
    { userId: "u1" }
  );
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// Versioned metadata policy: NEW PaymentIntents (carrying
// metadata_schema_version) must contain the required business fields; a
// missing required field BLOCKS the transition to paid.
// ---------------------------------------------------------------------------

const versioned = (extra: Record<string, unknown>) => ({
  metadata_schema_version: "1",
  ...extra,
});

test("policy: versioned PI missing required user metadata is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ service_type: "taxi", taxi_ride_id: "ride1" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id"] }
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.field, "user");
    assert.equal(r.reason, "metadata_user_missing_on_versioned_pi");
  }
});

test("policy: versioned PI missing required service_type is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", taxi_ride_id: "ride1" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id"] }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "service_type");
});

test("policy: versioned PI missing required entity id is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "taxi" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id"] }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "entity");
});

test("policy: versioned PI with all required fields present + matching passes", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "taxi", taxi_ride_id: "ride1" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id"] }
  );
  assert.equal(r.ok, true);
});

test("policy: versioned PI with WRONG entity id is rejected (wrong ride/order)", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "taxi", taxi_ride_id: "ride_OTHER" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id"] }
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.field, "entity");
    assert.equal(r.reason, "metadata_entity_mismatch");
  }
});

test("policy: cross-service replay rejected — taxi PI cannot settle a food order", () => {
  // A PaymentIntent minted for taxi (service_type=taxi) presented to a food
  // settlement (expects service_type=food) must be rejected.
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "taxi", taxi_ride_id: "ride1" }),
    { userId: "u1", serviceType: "food", entityId: "order1", entityIdKeys: ["order_id"] }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "service_type");
});

test("policy: entity id alias (ride_id) is honoured", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "taxi", ride_id: "ride1" }),
    { userId: "u1", serviceType: "taxi", entityId: "ride1", entityIdKeys: ["taxi_ride_id", "ride_id"] }
  );
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// Owner candidate list: a resource may have multiple legitimate owner columns
// (created_by vs client_user_id) while the PI records the single initiator.
// ---------------------------------------------------------------------------

test("expectation: userIds candidate list matches a secondary owner", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    { user_id: "u2" },
    { userIds: ["u1", "u2"] }
  );
  assert.equal(r.ok, true);
});

test("policy: versioned PI whose user matches NONE of the candidates is rejected", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u3", service_type: "delivery", delivery_request_id: "d1" }),
    {
      userIds: ["u1", "u2"],
      serviceType: "delivery",
      entityId: "d1",
      entityIdKeys: ["delivery_request_id"],
    }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "user");
});

test("policy: cross-service replay rejected — food PI cannot settle a delivery request", () => {
  const r = assertSettlementMatchesExpectation(
    settledOk,
    versioned({ user_id: "u1", service_type: "food", order_id: "order1" }),
    {
      userIds: ["u1"],
      serviceType: "delivery",
      entityId: "d1",
      entityIdKeys: ["delivery_request_id"],
    }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "service_type");
});

test("settlement result now carries resolved PI metadata", () => {
  const r = evaluateStripeSettlement({
    paymentIntent: {
      id: "pi_md",
      status: "succeeded",
      amount: 1000,
      currency: "usd",
      metadata: { service_type: "taxi", user_id: "u1" },
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.metadata?.service_type, "taxi");
    assert.equal(r.metadata?.user_id, "u1");
  }
});

console.log("requirePaymentIntentSucceeded tests passed");
