import assert from "node:assert/strict";
import {
  computeGlobalTrustScore,
  globalTrustBandLabel,
  resolveGlobalTrustBand,
} from "./driverIdentityTrustScore";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("resolveGlobalTrustBand maps score ranges", () => {
  assert.equal(resolveGlobalTrustBand(90), "excellent");
  assert.equal(resolveGlobalTrustBand(75), "good");
  assert.equal(resolveGlobalTrustBand(60), "average");
  assert.equal(resolveGlobalTrustBand(45), "elevated");
  assert.equal(resolveGlobalTrustBand(20), "critical");
});

test("globalTrustBandLabel returns French labels", () => {
  assert.equal(globalTrustBandLabel("excellent"), "Excellent");
  assert.equal(globalTrustBandLabel("critical"), "Critique");
});

test("computeGlobalTrustScore rewards seniority and penalizes suspensions", () => {
  const strong = computeGlobalTrustScore({
    seniorityDays: 365,
    totalTrips: 500,
    acceptanceRate: 0.95,
    cancellationRate: 0.03,
    averageRating: 4.8,
    suspensionCount: 0,
    previousVerificationCount: 2,
    incidentCount: 0,
    currentRiskScore: 10,
  });

  const weak = computeGlobalTrustScore({
    seniorityDays: 5,
    totalTrips: 2,
    acceptanceRate: 0.5,
    cancellationRate: 0.4,
    averageRating: 2.5,
    suspensionCount: 3,
    previousVerificationCount: 0,
    incidentCount: 4,
    currentRiskScore: 80,
  });

  assert.ok(strong.score > weak.score);
  assert.ok(strong.score >= 70);
  assert.ok(weak.score <= 55);
  assert.ok(strong.factors.some((factor) => factor.key === "seniority"));
  assert.ok(weak.factors.some((factor) => factor.key === "suspensions" && factor.impact < 0));
});

console.log("driverIdentityTrustScore tests passed");
