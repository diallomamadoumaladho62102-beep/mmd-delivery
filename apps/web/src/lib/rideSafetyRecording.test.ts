import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAFETY_RECORDING_CONSENT_MESSAGE,
  SAFETY_RECORDING_RETENTION_DAYS,
  buildSafetyRecordingStatusPayload,
  buildSafetyRecordingStoragePath,
  isActiveTaxiRideStatus,
} from "./rideSafetyRecording";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260731200000_ride_safety_recordings.sql",
);

test("consent message is explicit and visible", () => {
  assert.match(SAFETY_RECORDING_CONSENT_MESSAGE, /enregistrement de sécurité est en cours/i);
  assert.match(SAFETY_RECORDING_CONSENT_MESSAGE, /protéger les deux parties/i);
});

test("default retention is 14 days", () => {
  assert.equal(SAFETY_RECORDING_RETENTION_DAYS, 14);
});

test("status payload exposes both-party active flags", () => {
  const payload = buildSafetyRecordingStatusPayload([
    {
      id: "a",
      taxi_ride_id: "ride",
      initiator_user_id: "client",
      initiator_role: "client",
      recording_type: "client_audio",
      status: "recording",
    },
    {
      id: "b",
      taxi_ride_id: "ride",
      initiator_user_id: "driver",
      initiator_role: "driver",
      recording_type: "driver_video",
      status: "recording",
    },
  ]);
  assert.equal(payload.client_audio_active, true);
  assert.equal(payload.driver_video_active, true);
  assert.equal(payload.any_active, true);
});

test("storage path is private ride scoped", () => {
  const storagePath = buildSafetyRecordingStoragePath({
    rideId: "11111111-1111-1111-1111-111111111111",
    recordingId: "22222222-2222-2222-2222-222222222222",
    extension: "m4a",
  });
  assert.match(storagePath, /^11111111-1111-1111-1111-111111111111\//);
});

test("migration defines private bucket, retention and audit", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /ride-safety-recordings/);
  assert.match(sql, /,\s*false,/);
  assert.match(sql, /retention_days integer not null default 14/i);
  assert.match(sql, /locked_for_review/i);
  assert.match(sql, /participant_notified/i);
  assert.match(sql, /purge_expired_ride_safety_recordings/i);
  assert.match(sql, /resolve_ride_safety_recording_rules/i);
});

test("migration blocks hidden recording by requiring start RPC and events", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /start_ride_safety_recording/i);
  assert.match(sql, /log_ride_safety_recording_event/i);
  assert.match(sql, /audit_ride_safety_recording_access/i);
});

test("active ride statuses include in-progress trip", () => {
  assert.equal(isActiveTaxiRideStatus("in_progress"), true);
  assert.equal(isActiveTaxiRideStatus("completed"), false);
});

test("regional rules disable recording types", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /client_audio_not_allowed_in_region/i);
  assert.match(sql, /driver_video_not_allowed_in_region/i);
});

test("API routes exist for consent flow", () => {
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "apps", "web", "app", "api", "taxi", "rides", "safety-recording", "route.ts"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        repoRoot,
        "apps",
        "web",
        "app",
        "api",
        "cron",
        "ride-safety-recording-retention",
        "route.ts",
      ),
    ),
  );
});
