import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression: the on-route dark-blue street bubble (PointAnnotation
 * `driver-navigation-maneuver-bubble`) rendered as an empty blue rectangle
 * ahead of the vehicle on iOS/Android Mapbox. HUD already shows the street —
 * the map annotation must stay gone.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const mapScreen = fs.readFileSync(
  path.join(here, "../screens/DriverMapScreen.tsx"),
  "utf8",
);

assert.doesNotMatch(
  mapScreen,
  /driver-navigation-maneuver-bubble/,
  "maneuver bubble PointAnnotation must be removed",
);
assert.doesNotMatch(
  mapScreen,
  /DriverNavigationStreetBubbleLabel/,
  "street bubble label must not be mounted on the nav map",
);
assert.doesNotMatch(
  mapScreen,
  /maneuverBubblePoint/,
  "maneuverBubblePoint helper must not remain",
);
assert.match(
  mapScreen,
  /DriverNavigationRouteLayers/,
  "route layers must remain",
);
assert.match(
  mapScreen,
  /DriverNavigationVehicleMarker/,
  "vehicle marker must remain",
);
assert.match(
  mapScreen,
  /DriverNavigationHud/,
  "HUD instructions must remain",
);

const bubblePath = path.join(
  here,
  "../components/driver/DriverNavigationStreetBubble.tsx",
);
assert.equal(
  fs.existsSync(bubblePath),
  false,
  "DriverNavigationStreetBubble.tsx must be deleted",
);

console.log("navigationBlueArtifact.test.ts OK");
