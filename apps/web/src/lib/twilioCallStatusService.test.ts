import assert from "node:assert/strict";
import test from "node:test";

import { mapTwilioCallStatus } from "./chatReceiptStatus";

test("mapTwilioCallStatus includes queued as ringing", () => {
  assert.equal(mapTwilioCallStatus("queued"), "ringing");
});

test("terminal statuses are distinct for missed call handling", () => {
  assert.equal(mapTwilioCallStatus("busy"), "declined");
  assert.equal(mapTwilioCallStatus("no-answer"), "missed");
  assert.equal(mapTwilioCallStatus("failed"), "failed");
  assert.equal(mapTwilioCallStatus("canceled"), "canceled");
  assert.equal(mapTwilioCallStatus("completed"), "completed");
});
