import assert from "node:assert/strict";
import { buildDriverIdentityAiInsight } from "./driverIdentityAiInsight";
import { computeGlobalTrustScore } from "./driverIdentityTrustScore";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("buildDriverIdentityAiInsight stays read-only and flags unusual signals", () => {
  const trustScore = computeGlobalTrustScore({
    seniorityDays: 10,
    totalTrips: 5,
    acceptanceRate: 0.55,
    cancellationRate: 0.25,
    averageRating: 3.1,
    suspensionCount: 2,
    previousVerificationCount: 0,
    incidentCount: 3,
    currentRiskScore: 72,
  });

  const insight = buildDriverIdentityAiInsight({
    triggerType: "device_change",
    triggerReason: "Nouvel appareil détecté",
    riskScore: 72,
    requiresManualReview: true,
    trustScore,
    incidentCount: 3,
    suspensionCount: 2,
    securityChangeCount: 4,
    acceptanceRate: 0.55,
    cancellationRate: 0.25,
  });

  assert.match(insight.disclaimer, /lecture seule/i);
  assert.ok(insight.riskExplanation.length > 0);
  assert.ok(insight.unusualSignals.length > 0);
  assert.ok(insight.recommendedChecks.length > 0);
  assert.match(insight.summary, /Super Admin|humaine/i);
});

test("buildDriverIdentityAiInsight returns calm summary for clean profile", () => {
  const trustScore = computeGlobalTrustScore({
    seniorityDays: 400,
    totalTrips: 800,
    acceptanceRate: 0.92,
    cancellationRate: 0.04,
    averageRating: 4.7,
    suspensionCount: 0,
    previousVerificationCount: 1,
    incidentCount: 0,
    currentRiskScore: 12,
  });

  const insight = buildDriverIdentityAiInsight({
    triggerType: "scheduled",
    triggerReason: null,
    riskScore: 12,
    requiresManualReview: false,
    trustScore,
    incidentCount: 0,
    suspensionCount: 0,
    securityChangeCount: 0,
    acceptanceRate: 0.92,
    cancellationRate: 0.04,
  });

  assert.equal(insight.unusualSignals.length, 0);
  assert.match(insight.summary, /cohérent/i);
});

console.log("driverIdentityAiInsight tests passed");
