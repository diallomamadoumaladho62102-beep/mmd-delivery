import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression: the on-route dark-blue street bubble (PointAnnotation
 * `driver-navigation-maneuver-bubble`) rendered as an empty blue rectangle
 * ahead of the vehicle on iOS/Android Mapbox. HUD already shows the street —
 * the map annotation must stay gone.
 *
 * Vehicle presence must reuse the Home Driver Aurora marker
 * (`MmdDriverLocationMarker`) — never invent a second nav-only icon.
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
assert.doesNotMatch(
  mapScreen,
  /DriverNavigationVehicleMarker/,
  "nav must not use the old chevron SymbolLayer marker",
);
assert.doesNotMatch(
  mapScreen,
  /DriverNavigationThenToast/,
  "Then toast must not duplicate the HUD Then strip",
);
assert.match(
  mapScreen,
  /DriverNavigationRouteLayers/,
  "route layers must remain",
);
assert.match(
  mapScreen,
  /MmdDriverLocationMarker/,
  "vehicle marker must reuse Home Driver Aurora component",
);
assert.match(
  mapScreen,
  /DriverNavigationHud/,
  "HUD instructions must remain",
);
assert.match(
  mapScreen,
  /StatusBar[\s\S]*translucent/,
  "StatusBar must be translucent so HUD can paint edge-to-edge under the status bar",
);

const hudPath = path.join(
  here,
  "../components/driver/DriverNavigationHud.tsx",
);
const hudSrc = fs.readFileSync(hudPath, "utf8");
assert.match(hudSrc, /top:\s*0/, "HUD wrap must be flush top");
assert.match(hudSrc, /left:\s*0/, "HUD wrap must be flush left");
assert.match(hudSrc, /right:\s*0/, "HUD wrap must be flush right");
assert.match(
  hudSrc,
  /borderTopLeftRadius:\s*0/,
  "HUD must not round top-left when flush to screen",
);
assert.match(
  hudSrc,
  /borderTopRightRadius:\s*0/,
  "HUD must not round top-right when flush to screen",
);
assert.match(
  hudSrc,
  /resolveHudTopPadding/,
  "HUD content must use shared safe-area top padding helper",
);

const bottomPath = path.join(
  here,
  "../components/driver/DriverNavigationBottomBar.tsx",
);
const bottomSrc = fs.readFileSync(bottomPath, "utf8");
assert.match(bottomSrc, /left:\s*0/, "bottom bar flush left");
assert.match(bottomSrc, /right:\s*0/, "bottom bar flush right");
assert.match(bottomSrc, /bottom:\s*0/, "bottom bar flush bottom");
assert.match(
  bottomSrc,
  /borderBottomLeftRadius:\s*0/,
  "bottom bar must not round bottom-left when flush",
);
assert.match(
  bottomSrc,
  /borderBottomRightRadius:\s*0/,
  "bottom bar must not round bottom-right when flush",
);
assert.match(
  bottomSrc,
  /resolveBottomBarPadding/,
  "bottom bar content must use shared safe-area bottom padding helper",
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
