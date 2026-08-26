import assert from "node:assert/strict";
import { A2P_SAMPLE_MESSAGES, renderSmsTemplate } from "./smsTemplates";

const order = renderSmsTemplate("order_dispatched", { ref: "abc12345" });
assert.match(order, /MMD Delivery/);
assert.match(order, /ABC12345/);
assert.match(order, /STOP/);
assert.match(order, /HELP/);
assert.match(order, /Msg & data rates may apply/);
assert.doesNotMatch(order, /sale|promo|discount/i);

const taxi = renderSmsTemplate("taxi_dispatched", { ref: "ride-99" });
assert.match(taxi, /MMD Delivery/);
assert.doesNotMatch(taxi, /MMD Taxi/);

const help = renderSmsTemplate("help");
assert.match(help, /support@mmddelivery\.com/);
assert.match(help, /legal\/support/);
assert.match(help, /929/);

assert.equal(A2P_SAMPLE_MESSAGES.length >= 4, true);
for (const sample of A2P_SAMPLE_MESSAGES) {
  assert.match(sample, /MMD Delivery/);
  assert.match(sample, /STOP/);
}

console.log("smsTemplates.test.ts — PASS");
