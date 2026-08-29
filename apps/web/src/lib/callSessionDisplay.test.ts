import assert from "node:assert/strict";
import test from "node:test";

import {
  callSessionDurationSeconds,
  formatCallSessionDuration,
  resolveCallSessionDisplayStatus,
} from "./callSessionDisplay";
import {
  adminVoiceActionPatch,
  adminVoicePhase,
  canPerformAdminVoiceAction,
  nextStatusAfterAdminVoiceAction,
  shouldStopAdminVoiceRinging,
} from "./adminVoiceCallControl";
import {
  createAdminVoiceRingingController,
  incomingStatusesShouldRing,
} from "./adminVoiceRinging";
import { canControlMaskedCall, nextMaskedCallStatus } from "./maskedCallAction";

const NOW = Date.parse("2026-08-29T12:00:00.000Z");

test("incoming accept connected end state machine", () => {
  assert.equal(adminVoicePhase("in_ivr"), "incoming");
  assert.equal(nextStatusAfterAdminVoiceAction("accept", "in_ivr"), "ringing");
  assert.equal(shouldStopAdminVoiceRinging("ringing"), true);
  assert.equal(adminVoicePhase("answered"), "connected");
  assert.equal(nextStatusAfterAdminVoiceAction("end", "answered"), "completed");
  assert.equal(adminVoicePhase("completed"), "ended");
});

test("incoming decline ended state machine", () => {
  assert.equal(nextStatusAfterAdminVoiceAction("decline", "ringing"), "declined");
  assert.equal(shouldStopAdminVoiceRinging("declined"), true);
  assert.equal(canPerformAdminVoiceAction("decline", "completed"), false);
});

test("incoming caller cancel is terminal canceled", () => {
  assert.equal(adminVoicePhase("canceled"), "ended");
  assert.equal(shouldStopAdminVoiceRinging("canceled"), true);
});

test("incoming timeout maps to missed or expired", () => {
  assert.equal(adminVoicePhase("missed"), "ended");
  assert.equal(adminVoicePhase("expired"), "ended");
  assert.equal(shouldStopAdminVoiceRinging("missed"), true);
});

test("hold and resume are real conference actions only when connected", () => {
  assert.equal(canPerformAdminVoiceAction("hold", "answered"), true);
  assert.equal(canPerformAdminVoiceAction("hold", "in_ivr"), false);
  assert.equal(canPerformAdminVoiceAction("resume", "on_hold"), true);
  assert.equal(canPerformAdminVoiceAction("resume", "answered"), false);
  assert.equal(nextStatusAfterAdminVoiceAction("hold", "answered"), "on_hold");
  assert.equal(nextStatusAfterAdminVoiceAction("resume", "on_hold"), "answered");
  assert.equal(adminVoicePhase("on_hold"), "on_hold");
  assert.equal(shouldStopAdminVoiceRinging("on_hold"), true);
  const patch = adminVoiceActionPatch({
    action: "accept",
    actorUserId: "admin-1",
    current: { status: "in_ivr", assigned_admin_user_id: null, current_admin_user_id: null },
    nowIso: "2026-08-29T12:00:00.000Z",
  });
  assert.equal(patch?.assigned_admin_user_id, "admin-1");
  assert.equal(patch?.status, "ringing");
});

test("ringing cleanup after accept decline cancel timeout end", () => {
  let started = 0;
  let stopped = 0;
  const ringing = createAdminVoiceRingingController({
    start: () => {
      started += 1;
    },
    stop: () => {
      stopped += 1;
    },
  });
  ringing.sync({ shouldRing: true, audioBlocked: false });
  assert.equal(ringing.isPlaying(), true);
  ringing.stopAll();
  assert.equal(ringing.isPlaying(), false);
  assert.ok(stopped >= 1);
  assert.equal(incomingStatusesShouldRing(["answered"]), false);
  assert.equal(incomingStatusesShouldRing(["in_ivr"]), true);
  assert.ok(started >= 1);
});

test("duration uses endedAt - startedAt and never invents huge values", () => {
  const live = {
    status: "connected",
    started_at: "2026-08-29T11:59:00.000Z",
    ended_at: null,
  };
  assert.equal(callSessionDurationSeconds(live, NOW), 60);

  const completed = {
    status: "completed",
    started_at: "2026-08-29T11:58:00.000Z",
    ended_at: "2026-08-29T11:59:10.000Z",
  };
  assert.equal(callSessionDurationSeconds(completed, NOW), 70);
  assert.equal(formatCallSessionDuration(completed, NOW), "01:10");
});

test("expired active rows without ended_at do not keep growing", () => {
  const stale = {
    status: "active",
    started_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    ended_at: null,
    expires_at: "2026-07-01T00:30:00.000Z",
  };
  assert.equal(resolveCallSessionDisplayStatus(stale, NOW), "expired");
  assert.equal(callSessionDurationSeconds(stale, NOW), null);
  assert.equal(formatCallSessionDuration(stale, NOW), "—");
});

test("ownership is caller or target only", () => {
  assert.equal(
    canControlMaskedCall({
      userId: "a",
      callerUserId: "a",
      targetUserId: "b",
    }),
    true,
  );
  assert.equal(
    canControlMaskedCall({
      userId: "c",
      callerUserId: "a",
      targetUserId: "b",
    }),
    false,
  );
  assert.equal(nextMaskedCallStatus("decline", "b", "a"), "declined");
  assert.equal(nextMaskedCallStatus("decline", "a", "a"), "canceled");
});
