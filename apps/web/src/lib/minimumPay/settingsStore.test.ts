import assert from "node:assert/strict";
import test from "node:test";
import { resolvePayRuleForInstant } from "./settingsStore";
import type { PayRuleVersion } from "./types";

function rule(patch: Partial<PayRuleVersion> & { id: string }): PayRuleVersion {
  return {
    jurisdiction: "nyc",
    ruleName: "NYC Standard",
    ruleVersion: patch.id,
    effectiveFrom: "2000-01-01T00:00:00.000Z",
    effectiveTo: null,
    mprCentsPerHour: 1000,
    method: "standard",
    rounding: "ceil_cents",
    eligibleSourceTypes: ["delivery_share"],
    excludedSourceTypes: ["tip"],
    waitFeeCounts: false,
    bonusCounts: false,
    notes: null,
    status: "active",
    sourceUrl: null,
    sourceLabel: null,
    ...patch,
  };
}

test("creating a later rule does not overwrite an earlier period", () => {
  const v1 = rule({
    id: "v1",
    ruleVersion: "V1",
    mprCentsPerHour: 1000,
    effectiveFrom: "2000-01-01T00:00:00.000Z",
    effectiveTo: "2000-07-01T00:00:00.000Z",
  });
  const v2 = rule({
    id: "v2",
    ruleVersion: "V2",
    mprCentsPerHour: 2500,
    effectiveFrom: "2000-07-01T00:00:00.000Z",
    effectiveTo: null,
  });
  const early = resolvePayRuleForInstant([v1, v2], "nyc", "2000-03-01T00:00:00.000Z");
  const late = resolvePayRuleForInstant([v1, v2], "nyc", "2000-08-01T00:00:00.000Z");
  assert.equal(early?.id, "v1");
  assert.equal(early?.mprCentsPerHour, 1000);
  assert.equal(late?.id, "v2");
  assert.equal(late?.mprCentsPerHour, 2500);
});

test("missing overlapping rule is fail-closed", () => {
  const later = rule({
    id: "v2",
    effectiveFrom: "2000-07-01T00:00:00.000Z",
  });
  assert.equal(resolvePayRuleForInstant([later], "nyc", "2000-03-01T00:00:00.000Z"), null);
});

test("draft rules are never selected for calculation", () => {
  const draft = rule({
    id: "draft",
    status: "draft",
    mprCentsPerHour: 9999,
    effectiveFrom: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(resolvePayRuleForInstant([draft], "nyc", "2000-02-01T00:00:00.000Z"), null);
});
