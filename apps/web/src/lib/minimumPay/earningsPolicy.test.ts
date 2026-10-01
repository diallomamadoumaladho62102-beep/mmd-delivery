import assert from "node:assert/strict";
import test from "node:test";
import { sourceCountsTowardMinimum } from "./earningsPolicy";
import type { MinimumPayEngineSettings } from "./types";

const settings: Pick<
  MinimumPayEngineSettings,
  "eligibleSourceTypes" | "excludedSourceTypes" | "waitFeeCounts" | "bonusCounts"
> = {
  eligibleSourceTypes: ["delivery_share"],
  excludedSourceTypes: ["tip"],
  waitFeeCounts: false,
  bonusCounts: false,
};

test("eligible categories come from configuration", () => {
  assert.equal(
    sourceCountsTowardMinimum({ sourceType: "delivery_share", settings }),
    true
  );
  assert.equal(
    sourceCountsTowardMinimum({
      sourceType: "delivery_share",
      settings: { ...settings, eligibleSourceTypes: [] },
    }),
    false
  );
});

test("admin can exclude a previously eligible category", () => {
  assert.equal(
    sourceCountsTowardMinimum({
      sourceType: "delivery_share",
      settings: {
        ...settings,
        excludedSourceTypes: ["delivery_share"],
      },
    }),
    false
  );
});

test("wait fee and bonus follow admin flags", () => {
  assert.equal(
    sourceCountsTowardMinimum({ sourceType: "wait_fee", settings }),
    false
  );
  assert.equal(
    sourceCountsTowardMinimum({
      sourceType: "wait_fee",
      settings: { ...settings, waitFeeCounts: true },
    }),
    true
  );
  assert.equal(
    sourceCountsTowardMinimum({
      sourceType: "marketing_bonus",
      settings: { ...settings, bonusCounts: true },
    }),
    true
  );
});

test("minimum-pay adjustment never counts toward itself", () => {
  assert.equal(
    sourceCountsTowardMinimum({
      sourceType: "nyc_mpr_adjustment",
      settings: {
        ...settings,
        eligibleSourceTypes: ["nyc_mpr_adjustment"],
      },
    }),
    false
  );
});
