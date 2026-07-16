import assert from "node:assert/strict";
import {
  laneIndicationGlyph,
  parseMapboxLanes,
  shouldShowLaneGuidance,
} from "./navigationLanes";

const lanes = parseMapboxLanes([
  { lanes: null },
  {
    lanes: [
      { valid: false, indications: ["left"] },
      { valid: true, indications: ["straight"] },
      { valid: true, indications: ["straight", "right"] },
    ],
  },
]);

assert.equal(lanes?.length, 3, "parses last intersection with lanes");
assert.equal(lanes?.[0]?.valid, false);
assert.equal(lanes?.[1]?.valid, true);
assert.equal(laneIndicationGlyph(["left"]), "↰");
assert.equal(laneIndicationGlyph(["straight"]), "↑");
assert.equal(shouldShowLaneGuidance(lanes, 180), true);
assert.equal(shouldShowLaneGuidance(lanes, 400), false);
assert.equal(shouldShowLaneGuidance(lanes, 10), false);
assert.equal(shouldShowLaneGuidance([{ valid: true, indications: ["left"] }], 100), false);

assert.equal(parseMapboxLanes([]), undefined);
assert.equal(parseMapboxLanes(null), undefined);

console.log("navigationLanes.test.ts OK");
