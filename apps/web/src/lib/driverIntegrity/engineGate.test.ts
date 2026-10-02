import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultSettings, failClosedScanSkipReason, reassignmentIsActive, warningNotificationsAreActive } from "./engineGate";
import { mapIntegritySettingsRow } from "./settingsStore";

test("default settings keep every sensitive flag OFF and thresholds null", () => {
  const s = cloneDefaultSettings();
  assert.equal(s.monitoringEnabled, false);
  assert.equal(s.warningNotificationsEnabled, false);
  assert.equal(s.reassignmentEnabled, false);
  assert.equal(s.contactEnabled, false);
  assert.equal(s.reviewEnabled, false);
  assert.equal(s.sanctionWorkflowEnabled, false);
  assert.equal(s.driverAcceptanceWarningAfterSeconds, null);
  assert.equal(s.driverNoProgressReassignmentAfterSeconds, null);
  assert.equal(failClosedScanSkipReason(s), "monitoring_disabled");
});

test("missing row maps to fail-closed defaults", () => {
  const s = mapIntegritySettingsRow(null);
  assert.equal(s.monitoringEnabled, false);
  assert.equal(s.reassignmentEnabled, false);
});

test("reassignment requires monitoring AND reassignment flags", () => {
  const base = cloneDefaultSettings();
  assert.equal(reassignmentIsActive(base), false);
  assert.equal(
    reassignmentIsActive({ ...base, reassignmentEnabled: true }),
    false
  );
  assert.equal(
    reassignmentIsActive({
      ...base,
      monitoringEnabled: true,
      reassignmentEnabled: true,
    }),
    true
  );
});

test("warnings require monitoring AND notification flags", () => {
  const base = cloneDefaultSettings();
  assert.equal(warningNotificationsAreActive(base), false);
  assert.equal(
    warningNotificationsAreActive({
      ...base,
      monitoringEnabled: true,
      warningNotificationsEnabled: true,
    }),
    true
  );
});
