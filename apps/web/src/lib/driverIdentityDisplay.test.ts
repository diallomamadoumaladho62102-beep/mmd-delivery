import assert from "node:assert/strict";
import {
  confidenceScoreBadgeClass,
  identityStatusBadgeClass,
  identityStatusLabel,
  mapIdentityEvent,
  riskScoreBadgeClass,
} from "./driverIdentityDisplay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("maps identity status labels in French", () => {
  assert.equal(identityStatusLabel("verified"), "Vérifié");
  assert.equal(identityStatusLabel("required"), "Requis");
  assert.equal(identityStatusLabel("rejected"), "Refusé");
});

test("verified status uses green badge", () => {
  assert.match(identityStatusBadgeClass("verified"), /emerald/);
});

test("required status uses orange badge", () => {
  assert.match(identityStatusBadgeClass("required"), /amber/);
});

test("rejected status uses red badge", () => {
  assert.match(identityStatusBadgeClass("rejected"), /red/);
});

test("pending status uses yellow badge", () => {
  assert.match(identityStatusBadgeClass("pending"), /yellow/);
});

test("suspended-like expired status uses gray badge", () => {
  assert.match(identityStatusBadgeClass("expired"), /slate/);
});

test("risk score color thresholds", () => {
  assert.match(riskScoreBadgeClass(10), /emerald/);
  assert.match(riskScoreBadgeClass(45), /yellow/);
  assert.match(riskScoreBadgeClass(80), /red/);
});

test("confidence score color thresholds", () => {
  assert.match(confidenceScoreBadgeClass(30), /red/);
  assert.match(confidenceScoreBadgeClass(60), /amber/);
  assert.match(confidenceScoreBadgeClass(90), /emerald/);
});

test("maps timeline events to readable labels", () => {
  assert.equal(
    mapIdentityEvent({
      id: "1",
      event_type: "check_created",
      created_at: new Date().toISOString(),
    }).label,
    "Vérification créée",
  );
  assert.equal(
    mapIdentityEvent({
      id: "2",
      event_type: "check_approved",
      created_at: new Date().toISOString(),
    }).icon,
    "✅",
  );
});

console.log("driverIdentityDisplay tests passed");
