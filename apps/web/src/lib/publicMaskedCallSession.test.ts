import assert from "node:assert/strict";
import {
  sessionContainsPrivatePhone,
  toPublicMaskedCallSession,
} from "./publicMaskedCallSession";

const publicSession = toPublicMaskedCallSession(
  {
    id: "sess-1",
    order_id: "order-1",
    caller_role: "client",
    target_role: "driver",
    status: "active",
    proxy_number: "+15551212",
    expires_at: "2099-01-01T00:00:00.000Z",
    caller_phone: "+15550001111",
    target_phone: "+15550002222",
  },
  "+15551212"
);

assert.ok(publicSession);
assert.equal(publicSession?.id, "sess-1");
assert.equal(publicSession?.order_id, "order-1");
assert.equal(publicSession?.proxy_number, "+15551212");
assert.equal("caller_phone" in (publicSession ?? {}), false);
assert.equal("target_phone" in (publicSession ?? {}), false);
assert.equal(sessionContainsPrivatePhone(publicSession), false);
assert.equal(
  sessionContainsPrivatePhone({
    id: "x",
    caller_phone: "+15550001111",
  }),
  true
);

console.log("publicMaskedCallSession.test.ts OK");
