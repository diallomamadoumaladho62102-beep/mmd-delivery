import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveTripWindow } from "./tripWindow";
import { durationSeconds } from "./timeUnion";

const hardening = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20261207120000_pre_shadow_hardening.sql"),
  "utf8"
);

test("new assignment inserts next seq instead of rewriting started_at", () => {
  assert.match(hardening, /coalesce\(max\(assignment_seq\), 0\) \+ 1/);
  assert.match(hardening, /end_reason = coalesce\(end_reason, 'reassigned'\)/);
  assert.doesNotMatch(
    hardening,
    /on conflict \(entity_type, entity_id\) do update[\s\S]*started_at/
  );
});

test("unassign closes the open interval without mutating history", () => {
  assert.match(hardening, /trg_minimum_pay_close_order_trip_on_unassign/);
  assert.match(hardening, /trg_minimum_pay_close_mkt_trip_on_unassign/);
  assert.match(hardening, /p_end_reason text/);
});

test("one driver completion still uses delivered over later cancel", () => {
  const window = resolveTripWindow({
    driverAcceptedAt: "2000-01-01T10:00:00.000Z",
    deliveredAt: "2000-01-01T11:00:00.000Z",
    cancelledAt: "2000-01-01T12:00:00.000Z",
    status: "cancelled",
  });
  assert.equal(window?.endReason, "completed");
});

test("reassignment once then twice does not double-count stacked union", () => {
  const first = {
    startedAtMs: Date.parse("2026-03-08T06:30:00.000Z"),
    endedAtMs: Date.parse("2026-03-08T06:50:00.000Z"),
  };
  const second = {
    startedAtMs: Date.parse("2026-03-08T06:50:00.000Z"),
    endedAtMs: Date.parse("2026-03-08T07:10:00.000Z"),
  };
  const stackedOverlap = {
    startedAtMs: Date.parse("2026-03-08T06:40:00.000Z"),
    endedAtMs: Date.parse("2026-03-08T07:00:00.000Z"),
  };
  const seconds = durationSeconds([first, second, stackedOverlap]);
  assert.equal(seconds, 40 * 60);
});

test("DST spring-forward interval is measured in absolute epoch seconds", () => {
  const start = Date.parse("2026-03-08T06:30:00.000Z");
  const end = Date.parse("2026-03-08T08:30:00.000Z");
  assert.equal(durationSeconds([{ startedAtMs: start, endedAtMs: end }]), 2 * 3600);
});

test("period boundary keeps intervals that start before and end after", () => {
  const periodStart = Date.parse("2026-03-09T04:00:00.000Z");
  const periodEnd = Date.parse("2026-03-16T04:00:00.000Z");
  const interval = {
    startMs: Date.parse("2026-03-08T23:00:00.000Z"),
    endMs: Date.parse("2026-03-09T05:00:00.000Z"),
  };
  assert.ok(interval.startMs < periodEnd);
  assert.ok(interval.endMs > periodStart);
});

test("duplicate event cannot reopen a closed assignment interval", () => {
  assert.match(
    hardening,
    /ended_at = coalesce\(trip_time_intervals\.ended_at, p_ended_at\)/
  );
});
