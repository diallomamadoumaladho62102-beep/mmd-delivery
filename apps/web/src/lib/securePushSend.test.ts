import assert from "node:assert/strict";
import test from "node:test";
import { parseSecurePushSendBody } from "./securePushSend";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_CONTEXT = "22222222-2222-4222-8222-222222222222";

test("parseSecurePushSendBody requires context fields", () => {
  assert.throws(() =>
    parseSecurePushSendBody({
      user_id: VALID_UUID,
      title: "t",
      body: "b",
      role: "client",
    }),
  );

  const parsed = parseSecurePushSendBody({
    user_id: VALID_UUID,
    title: "t",
    body: "b",
    role: "driver",
    context_type: "delivery_requests",
    context_id: VALID_CONTEXT,
  });

  assert.equal(parsed.context_type, "delivery_requests");
  assert.equal(parsed.role, "driver");
});

test("parseSecurePushSendBody rejects invalid UUID", () => {
  assert.throws(() =>
    parseSecurePushSendBody({
      user_id: "not-a-uuid",
      title: "t",
      body: "b",
      role: "client",
      context_type: "orders",
      context_id: VALID_CONTEXT,
    }),
  );
});
