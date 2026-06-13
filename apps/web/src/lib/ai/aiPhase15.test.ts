import assert from "node:assert/strict";
import { estimateOpenAiCostUsd, mergeOpenAiUsage } from "./aiOpenAiPricing";
import { classifyAiIntent } from "./aiIntent";
import {
  getAiInternalBetaUserIds,
  isAiEmergencyStopEnv,
  isAiInternalBetaUser,
} from "./aiConfig";

const single = estimateOpenAiCostUsd({ promptTokens: 1000, completionTokens: 200 });
assert.equal(single.totalTokens, 1200);
assert.ok(single.estimatedCostUsd > 0);

const merged = mergeOpenAiUsage([
  estimateOpenAiCostUsd({ promptTokens: 500, completionTokens: 100 }),
  estimateOpenAiCostUsd({ promptTokens: 300, completionTokens: 50 }),
]);
assert.equal(merged.promptTokens, 800);
assert.equal(merged.completionTokens, 150);

assert.equal(classifyAiIntent("I need a taxi"), "book_taxi");
assert.equal(classifyAiIntent("hello there"), "general");

process.env.AI_INTERNAL_BETA_USER_IDS = "abc-123, def-456";
assert.equal(getAiInternalBetaUserIds().size, 2);
assert.equal(isAiInternalBetaUser("abc-123"), true);

process.env.AI_EMERGENCY_STOP = "true";
assert.equal(isAiEmergencyStopEnv(), true);

console.log("mmd-ai unit tests passed");
