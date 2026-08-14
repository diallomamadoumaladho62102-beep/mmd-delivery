import assert from "node:assert/strict";
import {
  buildSafetyRecordingStatusPayload,
  SAFETY_RECORDING_CONSENT_MESSAGE,
  type SafetyRecordingRow,
} from "./rideSafetyRecording";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const base = {
  taxi_ride_id: "11111111-1111-1111-1111-111111111111",
  initiator_user_id: "22222222-2222-2222-2222-222222222222",
  status: "recording" as const,
};

test("status payload tracks client + driver audio independently", () => {
  const payload = buildSafetyRecordingStatusPayload([
    {
      ...base,
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      initiator_role: "client",
      recording_type: "client_audio",
    },
    {
      ...base,
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      initiator_user_id: "33333333-3333-3333-3333-333333333333",
      initiator_role: "driver",
      recording_type: "driver_audio",
    },
  ] as SafetyRecordingRow[]);

  assert.equal(payload.client_audio_active, true);
  assert.equal(payload.driver_audio_active, true);
  assert.equal(payload.driver_video_active, false);
  assert.equal(payload.any_active, true);
  assert.ok(String(SAFETY_RECORDING_CONSENT_MESSAGE).includes("microphone"));
});

test("driver video does not imply driver audio", () => {
  const payload = buildSafetyRecordingStatusPayload([
    {
      ...base,
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      initiator_role: "driver",
      recording_type: "driver_video",
    },
  ] as SafetyRecordingRow[]);
  assert.equal(payload.driver_video_active, true);
  assert.equal(payload.driver_audio_active, false);
  assert.equal(payload.client_audio_active, false);
});

console.log("rideSafetyRecording tests passed");
