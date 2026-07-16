import assert from "node:assert/strict";
import test from "node:test";

import {
  formatChatReceiptLabel,
  mapTwilioCallStatus,
} from "./chatReceiptStatus";

test("mapTwilioCallStatus handles all Twilio terminal states", () => {
  assert.equal(mapTwilioCallStatus("queued"), "ringing");
  assert.equal(mapTwilioCallStatus("initiated"), "ringing");
  assert.equal(mapTwilioCallStatus("ringing"), "ringing");
  assert.equal(mapTwilioCallStatus("in-progress"), "connected");
  assert.equal(mapTwilioCallStatus("answered"), "connected");
  assert.equal(mapTwilioCallStatus("completed"), "completed");
  assert.equal(mapTwilioCallStatus("busy"), "declined");
  assert.equal(mapTwilioCallStatus("failed"), "failed");
  assert.equal(mapTwilioCallStatus("no-answer"), "missed");
  assert.equal(mapTwilioCallStatus("canceled"), "canceled");
  assert.equal(mapTwilioCallStatus("cancelled"), "canceled");
  assert.equal(mapTwilioCallStatus(""), null);
});

test("formatChatReceiptLabel maps delivery states", () => {
  assert.equal(formatChatReceiptLabel("sent"), "Envoyé");
  assert.equal(formatChatReceiptLabel("delivered"), "Distribué");
  assert.equal(formatChatReceiptLabel("read"), "Lu");
  assert.equal(formatChatReceiptLabel(null), "Envoyé");
});
