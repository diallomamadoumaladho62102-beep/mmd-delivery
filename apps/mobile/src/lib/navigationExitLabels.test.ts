import assert from "node:assert/strict";
import { extractMapboxExitNumber } from "./navigationExit";
import {
  formatExitBadgeLabel,
  formatRoundaboutExitLabel,
} from "./navigationLocale";

assert.equal(
  extractMapboxExitNumber({
    exits: "398B",
    instruction: "Take the ramp",
    maneuverType: "off ramp",
  }),
  "398B",
  "uses Mapbox exits field",
);

assert.equal(
  extractMapboxExitNumber({
    instruction: "Take exit 12 onto I-95",
    maneuverType: "off ramp",
  }),
  "12",
  "parses exit from instruction text",
);

assert.equal(
  extractMapboxExitNumber({
    instruction: "Turn left onto Main St",
    maneuverType: "turn",
  }),
  null,
  "never invents an exit",
);

assert.equal(formatExitBadgeLabel("398B", "en"), "Exit 398B");
assert.equal(formatExitBadgeLabel("12", "fr"), "Sortie 12");
assert.equal(formatRoundaboutExitLabel(2, "en"), "Take the 2nd exit");
assert.equal(formatRoundaboutExitLabel(2, "fr"), "Prenez la 2e sortie");

console.log("navigationExitLabels.test.ts OK");
