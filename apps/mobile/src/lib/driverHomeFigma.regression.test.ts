/**
 * Final Figma driver map framing: 14 px route, 3.5× crop, no abandoned 1.4× home delta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_VISUAL_CALIB } from "./driverNavigationVisual";
import { routeLineWidthPx } from "./driverNavigationRouteStyle";
import { ROUTE_LINE_WIDTH_RATIO } from "./driverNavigationVisual";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.readFileSync(path.join(here, "../screens/DriverHomeScreen.tsx"), "utf8");
const sheet = fs.readFileSync(
  path.join(here, "../components/driver/home/DriverHomePremiumSheet.tsx"),
  "utf8",
);

assert.equal(routeLineWidthPx(390, ROUTE_LINE_WIDTH_RATIO), 14);
assert.ok(Math.abs(NAV_VISUAL_CALIB.zoomOffset - -Math.log2(3.5)) < 1e-9);
assert.ok(Math.abs(NAV_VISUAL_CALIB.zoomOffset - -Math.log2(1.4)) > 0.5);
assert.match(home, /const DRIVER_MAP_CROP = 3\.5/);
assert.match(home, /DRIVER_MAP_CROP_ABANDONED = 1\.4/);
assert.match(home, /zoomLevel=\{DRIVER_HOME_ZOOM\}/);
assert.doesNotMatch(home, /latitudeDelta: 0\.035/);
assert.doesNotMatch(home, /backgroundColor: "rgba\(0,51,153,0\.45\)"/);
assert.match(sheet, /#082F49/);
assert.match(sheet, /#0F172A/);
assert.match(sheet, /nextRideTitle/);
assert.match(sheet, /radarSpinStyle/);
assert.doesNotMatch(sheet, /MMD Smart Dispatch/);
assert.doesNotMatch(sheet, /onPress=\{onViewHotspots\}/);
assert.doesNotMatch(sheet, /styles\.intelStrip/);
assert.match(home, /duration: 2000/);
assert.match(home, /fontSize: 28/);
assert.match(home, /#F97316/);
assert.match(home, /#EF4444/);
assert.doesNotMatch(home, /pickup-location/);
assert.doesNotMatch(home, /dropoff-location/);
console.log("driverHomeFigma.regression.test.ts ok");
