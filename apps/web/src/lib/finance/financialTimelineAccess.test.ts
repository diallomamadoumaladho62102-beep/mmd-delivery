import assert from "node:assert/strict";
import {
  isFinancialEntityId,
  redactFinancialEventReferences,
  resolveDeliveryRequestTimelineRole,
  resolveOrderTimelineRole,
  resolveWalletTimelineAccess,
} from "./financialTimelineAccess";
import type { FinancialTimelineEvent } from "./financialTimelineTypes";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

assert.equal(isFinancialEntityId(USER_A), true);
assert.equal(isFinancialEntityId("not-a-uuid"), false);
assert.equal(isFinancialEntityId(""), false);

assert.equal(resolveWalletTimelineAccess(USER_A, USER_A).ok, true);
const walletDenied = resolveWalletTimelineAccess(USER_A, USER_B);
assert.equal(walletDenied.ok, false);
if (walletDenied.ok === false) {
  assert.equal(walletDenied.status, 403);
}

assert.deepEqual(
  resolveOrderTimelineRole(USER_A, {
    client_user_id: USER_A,
    restaurant_user_id: USER_B,
    driver_id: null,
  }),
  { ok: true, role: "client" }
);
assert.deepEqual(
  resolveOrderTimelineRole(USER_B, {
    client_user_id: USER_A,
    restaurant_user_id: USER_B,
    driver_id: null,
  }),
  { ok: true, role: "restaurant" }
);
assert.deepEqual(
  resolveOrderTimelineRole(USER_B, {
    client_user_id: USER_A,
    restaurant_user_id: null,
    driver_id: USER_B,
  }),
  { ok: true, role: "driver" }
);
assert.equal(
  resolveOrderTimelineRole("44444444-4444-4444-8444-444444444444", {
    client_user_id: USER_A,
    restaurant_user_id: USER_B,
    driver_id: null,
  }).ok,
  false
);
assert.equal(resolveOrderTimelineRole(USER_A, null).ok, false);

assert.deepEqual(
  resolveDeliveryRequestTimelineRole(USER_A, {
    client_user_id: USER_A,
    created_by: USER_A,
    driver_id: null,
  }),
  { ok: true, role: "client" }
);
assert.equal(
  resolveDeliveryRequestTimelineRole(USER_B, {
    client_user_id: USER_A,
    created_by: USER_A,
    driver_id: null,
  }).ok,
  false
);

const event: FinancialTimelineEvent = {
  id: "e1",
  kind: "payment_intent",
  status: "paid",
  amount_cents: 1200,
  currency: "USD",
  direction: "debit",
  title_key: "finance.event.payment",
  title_fallback: "Payment",
  entity_type: "order",
  entity_id: ORDER_ID,
  occurred_at: "2026-08-28T00:00:00.000Z",
  references: { payment_intent_id: "pi_secret_other_user" },
};

const clientEvents = redactFinancialEventReferences([event], "client");
assert.equal(clientEvents[0]?.references, undefined);
assert.equal(
  redactFinancialEventReferences([event], "admin")[0]?.references?.payment_intent_id,
  "pi_secret_other_user"
);

console.log("financialTimelineAccess.test.ts OK");
