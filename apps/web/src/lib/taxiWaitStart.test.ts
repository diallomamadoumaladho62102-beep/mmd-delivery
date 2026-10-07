import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveTaxiWaitStart } from "./taxiWaitStart";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

const near = { ok: true as const, distanceMeters: 12 };
const far = { ok: false as const, error: "too_far_from_target", distanceMeters: 400 };

test("waiting does not start before a valid arrival", () => {
  const blocked = resolveTaxiWaitStart({
    status: "accepted",
    driverArrivedAt: null,
    waitTimerStartedAt: null,
    nowIso: "2026-10-07T12:00:00.000Z",
    proximity: far,
  });
  assert.equal(blocked.action, "reject");

  const wrongStatus = resolveTaxiWaitStart({
    status: "in_progress",
    driverArrivedAt: null,
    waitTimerStartedAt: null,
    nowIso: "2026-10-07T12:00:00.000Z",
    proximity: near,
  });
  assert.equal(wrongStatus.action, "reject");
});

test("driver arrival starts one timer and a second arrival does not move it", () => {
  const started = resolveTaxiWaitStart({
    status: "accepted",
    driverArrivedAt: null,
    waitTimerStartedAt: null,
    nowIso: "2026-10-07T12:00:00.000Z",
    proximity: near,
  });
  assert.deepEqual(started, {
    action: "start",
    startedAt: "2026-10-07T12:00:00.000Z",
    distanceMeters: 12,
  });

  const duplicate = resolveTaxiWaitStart({
    status: "driver_arrived",
    driverArrivedAt: "2026-10-07T12:00:00.000Z",
    waitTimerStartedAt: "2026-10-07T12:00:00.000Z",
    nowIso: "2026-10-07T12:20:00.000Z",
    proximity: near,
  });
  assert.equal(duplicate.action, "idempotent");
  if (duplicate.action === "idempotent") {
    assert.equal(duplicate.waitTimerStartedAt, "2026-10-07T12:00:00.000Z");
  }
});

test("GPS arrive without wait columns backfills the original server timestamp", () => {
  const backfill = resolveTaxiWaitStart({
    status: "driver_arrived",
    driverArrivedAt: "2026-10-07T12:00:00.000Z",
    waitTimerStartedAt: null,
    nowIso: "2026-10-07T12:03:00.000Z",
    proximity: near,
  });
  assert.deepEqual(backfill, {
    action: "backfill",
    startedAt: "2026-10-07T12:00:00.000Z",
    distanceMeters: 12,
  });
});

test("taxi arrive SQL stamps the wait timer and ignores client wait fees", () => {
  const sql = fs.readFileSync(
    path.join(repoRoot, "supabase/migrations/20261216120000_taxi_wait_timer_on_arrive.sql"),
    "utf8"
  );
  assert.match(sql, /wait_timer_started_at = coalesce\(wait_timer_started_at, driver_arrived_at, now\(\)\)/);
  assert.match(sql, /driver_distance_to_target_meters/);
  assert.match(sql, /manual_arrival_required = false/);
  assert.doesNotMatch(sql, /wait_fee_amount_cents\s*=/);
  assert.match(sql, /status = v_ride.status/);

  const quote = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/taxi/rides/quote/route.ts"),
    "utf8"
  );
  assert.doesNotMatch(quote, /wait_fee/);
  assert.doesNotMatch(quote, /from\("taxi_rides"\)/);
});
