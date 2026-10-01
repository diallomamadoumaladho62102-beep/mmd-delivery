import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveTripWindow } from "./tripWindow";

const webRoot = process.cwd();
const migration = readFileSync(
  join(webRoot, "../../supabase/migrations/20261130120000_minimum_pay_engine.sql"),
  "utf8"
);
const confirm = readFileSync(
  join(webRoot, "../../supabase/migrations/20260603130000_commercial_production_hardening_v2.sql"),
  "utf8"
);
const cancel = readFileSync(join(webRoot, "app/api/orders/cancel/route.ts"), "utf8");

test("delivered_at is server-controlled via now() and coalesce", () => {
  assert.match(confirm, /delivered_at = coalesce\(delivered_at, now\(\)\)/);
  assert.doesNotMatch(confirm, /p_delivered_at/);
});

test("cancelled_at on the cancel API is server nowIso not a client stamp", () => {
  assert.match(cancel, /const canceledAt = nowIso\(\)/);
  assert.doesNotMatch(cancel, /body\.cancelled_at/);
});

test("duplicate completion cannot reopen a closed interval", () => {
  assert.match(migration, /started_at is never rewritten/);
  assert.match(
    migration,
    /ended_at = coalesce\(public\.trip_time_intervals\.ended_at, excluded\.ended_at\)/
  );
});

test("delivered wins over cancelled so a later cancel cannot move the end", () => {
  const delivered = resolveTripWindow({
    driverAcceptedAt: "2000-01-01T10:00:00.000Z",
    deliveredAt: "2000-01-01T11:00:00.000Z",
    cancelledAt: "2000-01-01T12:00:00.000Z",
    status: "cancelled",
  });
  assert.equal(delivered?.endReason, "completed");
  assert.equal(delivered?.endedAt, "2000-01-01T11:00:00.000Z");
});

test("cancelled trip cannot later become a delivered window in the helper", () => {
  const cancelled = resolveTripWindow({
    driverAcceptedAt: "2000-01-01T10:00:00.000Z",
    cancelledAt: "2000-01-01T10:20:00.000Z",
    status: "cancelled",
  });
  assert.equal(cancelled?.endReason, "cancelled");
});

test("existing accept RPCs require restaurant READY before driver_id is set", () => {
  const offerAccept = readFileSync(
    join(webRoot, "../../supabase/migrations/20261001120000_fix_driver_accept_kind_and_profiles_updated_at.sql"),
    "utf8"
  );
  const readyAccept = readFileSync(
    join(webRoot, "../../supabase/migrations/20260608160000_final_security_before_taxi.sql"),
    "utf8"
  );
  assert.match(offerAccept, /order_not_ready/);
  assert.match(offerAccept, /lower\(v_order\.status\), ''\) <> 'ready'/);
  assert.match(readyAccept, /lower\(coalesce\(status, ''\)\) = 'ready'/);
});

test("existing order APIs reject delivered after cancel and cancel after delivered", () => {
  assert.match(cancel, /if \(status === "delivered"\)/);
  assert.match(cancel, /Delivered order cannot be cancelled/);
  assert.match(confirm, /in \('picked_up', 'dispatched'\)/);
  assert.doesNotMatch(confirm, /p_delivered_at/);
});
