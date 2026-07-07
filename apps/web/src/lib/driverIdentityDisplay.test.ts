import assert from "node:assert/strict";
import {
  buildIdentityRiskReasonBadges,
  confidenceScoreBadgeClass,
  formatIdentityWaitSla,
  identityStatusBadgeClass,
  identityStatusLabel,
  mapIdentityEvent,
  matchesIdentityQueueFilter,
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

test("formats wait SLA in French", () => {
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  assert.equal(
    formatIdentityWaitSla({
      status: "submitted",
      created_at: twentyMinutesAgo,
      submitted_at: twentyMinutesAgo,
    }),
    "En attente depuis 20 min",
  );
});

test("builds explicit risk reason badges", () => {
  const badges = buildIdentityRiskReasonBadges({
    trigger_type: "phone_change",
    reason: "Phone number was updated.",
    requires_manual_review: true,
    risk_score: 65,
  });
  assert.ok(badges.some((badge) => badge.label.includes("téléphone")));
  assert.ok(badges.some((badge) => badge.label.includes("Revue manuelle")));
});

test("matches queue filters", () => {
  assert.equal(
    matchesIdentityQueueFilter(
      { status: "submitted", risk_score: 70, requires_manual_review: false },
      "waiting",
    ),
    true,
  );
  assert.equal(
    matchesIdentityQueueFilter(
      { status: "verified", risk_score: 70, requires_manual_review: false },
      "high_risk",
    ),
    true,
  );
});

console.log("driverIdentityDisplay tests passed");
