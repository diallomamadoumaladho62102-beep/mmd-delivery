import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isWaitTimerGpsValidated } from "./waitTimerTypes";
import { computeWaitTimerState } from "./waitFeeCalculator";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

test("isWaitTimerGpsValidated requires arrival, distance, and no manual flag", () => {
  assert.equal(
    isWaitTimerGpsValidated({
      driver_arrived_at: null,
      manual_arrival_required: false,
      driver_distance_to_target_meters: 10,
    }),
    false
  );

  assert.equal(
    isWaitTimerGpsValidated({
      driver_arrived_at: new Date().toISOString(),
      manual_arrival_required: true,
      driver_distance_to_target_meters: 10,
    }),
    false
  );

  assert.equal(
    isWaitTimerGpsValidated({
      driver_arrived_at: new Date().toISOString(),
      manual_arrival_required: false,
      driver_distance_to_target_meters: 51,
    }),
    false
  );

  assert.equal(
    isWaitTimerGpsValidated({
      driver_arrived_at: new Date().toISOString(),
      manual_arrival_required: false,
      driver_distance_to_target_meters: 50,
    }),
    true
  );
});

test("wait timer late fee tiers cap at 225 cents", () => {
  const started = new Date(Date.now() - 20 * 60 * 1000);
  const state = computeWaitTimerState({ waitTimerStartedAt: started, entityKind: "delivery" });
  assert.equal(state.wait_fee_cents, 225);
  assert.equal(state.max_fee_reached, true);
});

test("deposit at door only after max fee when leave_at_door enabled", () => {
  const beforeCap = new Date(Date.now() - 7 * 60 * 1000);
  const early = computeWaitTimerState({
    waitTimerStartedAt: beforeCap,
    leaveAtDoor: true,
    entityKind: "delivery",
  });
  assert.equal(early.can_deposit_at_door, false);

  const afterCap = new Date(Date.now() - 13 * 60 * 1000);
  const late = computeWaitTimerState({
    waitTimerStartedAt: afterCap,
    leaveAtDoor: true,
    entityKind: "delivery",
  });
  assert.equal(late.can_deposit_at_door, true);
});

test("taxi no-show gate opens after max wait fee window", () => {
  const started = new Date(Date.now() - 13 * 60 * 1000);
  const state = computeWaitTimerState({ waitTimerStartedAt: started, entityKind: "taxi" });
  assert.equal(state.can_cancel_no_penalty, true);
});

test("wait_timer_events RLS migration restricts participant reads", () => {
  const migrationPath = path.join(
    repoRoot,
    "supabase",
    "migrations",
    "20260725120000_wait_timer_events_rls_hardening.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  const required = [
    "wait_timer_events_select_participants",
    "order_participant_ids",
    "delivery_request_participant_ids",
    "taxi_ride_participant_ids",
    "order_events_select_participants",
    "is_staff_user",
  ];
  for (const snippet of required) {
    assert.ok(sql.includes(snippet), `migration missing: ${snippet}`);
  }
  assert.ok(!sql.includes("using (true)"), "must not grant blanket read access");
});

test("payment webhook service deduplicates via unique external event id", () => {
  const servicePath = path.join(repoRoot, "apps", "web", "src", "lib", "paymentWebhookService.ts");
  const txPath = path.join(repoRoot, "apps", "web", "src", "lib", "paymentTransactionService.ts");
  const webhook = fs.readFileSync(servicePath, "utf8");
  const tx = fs.readFileSync(txPath, "utf8");
  assert.ok(webhook.includes("duplicate: true"));
  assert.ok(tx.includes("23505"));
});

test("late fee billing uses payment_transaction reference in ledger bridge", () => {
  const bridgePath = path.join(repoRoot, "apps", "web", "src", "lib", "waitTimerLateFeeBridge.ts");
  const billingPath = path.join(repoRoot, "apps", "web", "src", "lib", "waitTimerLateFeeBilling.ts");
  const bridge = fs.readFileSync(bridgePath, "utf8");
  const billing = fs.readFileSync(billingPath, "utf8");
  assert.ok(bridge.includes('referenceType: "payment_transaction"'));
  assert.ok(billing.includes("createLateFeePaymentTransaction"));
  assert.ok(billing.includes("gps_not_validated"));
});
