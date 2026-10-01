import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultSettings } from "./engineGate";
import {
  anomalyIsNotAutomaticFraud,
  applyPolicyAction,
  applyReviewDecision,
  canTransitionIncident,
  clientCannotDecideSanction,
  reassignmentIsNotAutomaticSuspension,
  timeoutIsNotAutomaticSuspension,
} from "./reviewPolicy";
import { disputeCannotMutateTripClock, freezeTimestamp } from "./timestampGuards";

test("review state machine follows warning → reassigned → review → decision → policy", () => {
  assert.equal(canTransitionIncident("open", "warning"), true);
  assert.equal(canTransitionIncident("warning", "final_warning"), true);
  assert.equal(canTransitionIncident("final_warning", "reassigned"), true);
  assert.equal(canTransitionIncident("reassigned", "review"), true);
  assert.equal(canTransitionIncident("review", "confirmed"), true);
  assert.equal(canTransitionIncident("confirmed", "policy_action"), true);
  assert.equal(canTransitionIncident("open", "policy_action"), false);
  assert.equal(canTransitionIncident("warning", "confirmed"), false);
});

test("review decision cannot be applied outside review", () => {
  assert.equal(applyReviewDecision({ current: "warning", decision: "confirmed" }).ok, false);
  const decided = applyReviewDecision({ current: "review", decision: "not_confirmed" });
  assert.equal(decided.ok, true);
  if (decided.ok === true) assert.equal(decided.next, "not_confirmed");
});

test("sanctions require confirmed review, workflow flag, and admin id", () => {
  const off = cloneDefaultSettings();
  const disabled = applyPolicyAction({
    settings: off,
    current: "confirmed",
    action: "suspension",
    adminUserId: "admin",
  });
  assert.equal(disabled.ok, false);
  if (disabled.ok === false) assert.equal(disabled.reason, "sanction_workflow_disabled");
  const on = {
    ...off,
    monitoringEnabled: true,
    reviewEnabled: true,
    sanctionWorkflowEnabled: true,
  };
  const noAdmin = applyPolicyAction({
    settings: on,
    current: "confirmed",
    action: "suspension",
    adminUserId: null,
  });
  assert.equal(noAdmin.ok, false);
  if (noAdmin.ok === false) assert.equal(noAdmin.reason, "admin_required");
  const tooEarly = applyPolicyAction({
    settings: on,
    current: "warning",
    action: "suspension",
    adminUserId: "admin",
  });
  assert.equal(tooEarly.ok, false);
  if (tooEarly.ok === false) assert.equal(tooEarly.reason, "must_be_confirmed");
  const applied = applyPolicyAction({
    settings: on,
    current: "confirmed",
    action: "suspension",
    adminUserId: "admin",
  });
  assert.equal(applied.ok, true);
  if (applied.ok === true) assert.equal(applied.next, "policy_action");
});

test("anomaly, reassignment, and timeout are never automatic fraud or suspension", () => {
  assert.equal(anomalyIsNotAutomaticFraud(), true);
  assert.equal(reassignmentIsNotAutomaticSuspension(), true);
  assert.equal(timeoutIsNotAutomaticSuspension(), true);
  assert.equal(clientCannotDecideSanction(), true);
});

test("original timestamps stay frozen", () => {
  const original = "2026-10-01T12:00:00.000Z";
  assert.equal(freezeTimestamp(original, "2026-10-01T12:59:00.000Z"), original);
  assert.equal(freezeTimestamp(original, null), original);
  const clock = disputeCannotMutateTripClock();
  assert.equal(clock.driverAcceptedAt, "immutable");
  assert.equal(clock.earnings, "immutable");
});
