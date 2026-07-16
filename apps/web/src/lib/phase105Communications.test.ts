import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParticipantRpc,
  getUserIdByRole,
  normalizeSourceTable,
} from "./maskedCallCreate";
import {
  buildChatImageStoragePath,
  CHAT_IMAGE_BUCKET,
  toChatImagePath,
} from "./chatUploadSecurity";
import { getTwilioPhoneNumber } from "./twilioPhone";
import {
  formatChatReceiptLabel,
  mapTwilioCallStatus,
} from "./chatReceiptStatus";

test("normalizeSourceTable supports marketplace delivery jobs", () => {
  assert.equal(
    normalizeSourceTable("marketplace_delivery_jobs"),
    "marketplace_delivery_jobs",
  );
  assert.equal(
    normalizeSourceTable("marketplace_delivery_job"),
    "marketplace_delivery_jobs",
  );
});

test("getUserIdByRole maps marketplace seller as restaurant", () => {
  assert.equal(
    getUserIdByRole(
      {
        id: "job-1",
        client_id: "client-1",
        assigned_driver_id: "driver-1",
        seller_user_id: "seller-1",
      },
      "restaurant",
      "marketplace_delivery_jobs",
    ),
    "seller-1",
  );
});

test("buildParticipantRpc selects marketplace RPC", () => {
  assert.deepEqual(buildParticipantRpc("marketplace_delivery_jobs", "job-abc"), {
    fn: "marketplace_delivery_job_participant_ids",
    args: { p_job_id: "job-abc" },
  });
});

test("chat image paths use canonical bucket", () => {
  const key = buildChatImageStoragePath("order-1", "png");
  assert.ok(key.startsWith("order-1/"));
  assert.equal(toChatImagePath(key), `chat-images/${key}`);
  assert.equal(CHAT_IMAGE_BUCKET, "chat-images");
});

test("getTwilioPhoneNumber prefers env", () => {
  const previous = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_PHONE_NUMBER = "+15551234567";
  try {
    assert.equal(getTwilioPhoneNumber(), "+15551234567");
  } finally {
    if (previous === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = previous;
  }
});

test("mapTwilioCallStatus maps ringing answered completed busy failed no-answer canceled", () => {
  assert.equal(mapTwilioCallStatus("ringing"), "ringing");
  assert.equal(mapTwilioCallStatus("in-progress"), "connected");
  assert.equal(mapTwilioCallStatus("answered"), "connected");
  assert.equal(mapTwilioCallStatus("completed"), "completed");
  assert.equal(mapTwilioCallStatus("busy"), "declined");
  assert.equal(mapTwilioCallStatus("failed"), "failed");
  assert.equal(mapTwilioCallStatus("no-answer"), "missed");
  assert.equal(mapTwilioCallStatus("canceled"), "canceled");
});

test("formatChatReceiptLabel returns sent delivered read labels", () => {
  assert.equal(formatChatReceiptLabel("sent"), "Envoyé");
  assert.equal(formatChatReceiptLabel("delivered"), "Distribué");
  assert.equal(formatChatReceiptLabel("read"), "Lu");
});
