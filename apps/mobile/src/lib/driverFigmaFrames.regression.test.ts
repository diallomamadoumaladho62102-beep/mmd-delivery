/**
 * Regression: Figma driver navigation, home, and offer frames (2026-10-14).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeMapZoom,
  computeNavigationScreenLayout,
  MAP_CLOSE_FRAMING,
  MAP_CLOSE_ZOOM_DELTA,
  NAV_CAMERA,
  NAV_ROUTE_LINE_WIDTH_PX,
  NAV_VISUAL_CALIB,
} from "./driverNavigationVisual";
import { routeLineWidthExpression, routeLineWidthPx } from "./driverNavigationRouteStyle";
import { onlineSheetMaxHeightPx } from "./driverScreenSafeArea";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.readFileSync(path.join(here, "../screens/DriverHomeScreen.tsx"), "utf8");
const sheet = fs.readFileSync(
  path.join(here, "../components/driver/home/DriverHomePremiumSheet.tsx"),
  "utf8",
);
const camera = fs.readFileSync(path.join(here, "../hooks/useDriverNavigationCamera.ts"), "utf8");

assert.equal(MAP_CLOSE_FRAMING, 3.5);
assert.ok(Math.abs(MAP_CLOSE_ZOOM_DELTA - Math.log2(3.5)) < 1e-12);
assert.ok(Math.abs(closeMapZoom(13) - (13 + Math.log2(3.5))) < 1e-12);
assert.ok(Math.abs(NAV_VISUAL_CALIB.zoomOffset - (-1.85 + Math.log2(3.5))) < 1e-12);

assert.equal(NAV_ROUTE_LINE_WIDTH_PX, 14);
assert.equal(routeLineWidthPx(390, 0.02), 14);
assert.equal(routeLineWidthPx(320, 1), 14);
const widthExpr = routeLineWidthExpression(390, 1);
assert.equal(widthExpr[4], 14);
assert.equal(widthExpr[6], 14);
assert.equal(widthExpr[8], 14);
const layout = computeNavigationScreenLayout({ width: 390, height: 844 });
assert.equal(layout.routeFutureWidth, 14);
assert.equal(layout.routeTraveledWidth, 14);
assert.ok(NAV_CAMERA.zoom > 18 && NAV_CAMERA.zoom < 20);
assert.ok(NAV_CAMERA.zoom <= NAV_CAMERA.zoomMax);
assert.ok(NAV_CAMERA.zoomMin < NAV_CAMERA.zoom);

assert.match(home, /zoomLevel=\{closeMapZoom\(13\)\}/);
assert.match(home, /coursePhase=\{!isOnline \? "offline" : gpsLoading \? "locating" : "searching"\}/);
assert.doesNotMatch(home, /rgba\(0,\s*51,\s*153,\s*0\.45\)/);
assert.doesNotMatch(home, /PointAnnotation id="pickup-location"/);
assert.doesNotMatch(home, /PointAnnotation id="dropoff-location"/);
assert.match(home, /New delivery available/);
assert.match(home, /Pickup:/);
assert.match(home, /Dropoff:/);
assert.match(home, />Ignore</);
assert.match(home, /"Accept"/);
assert.match(home, /fontSize: 28/);
assert.match(home, /fontSize: 22/);
assert.match(home, /fontSize: 20/);
assert.match(home, /fontSize: 18/);
assert.match(home, /backgroundColor: "#DC2626"/);
assert.match(home, /backgroundColor: "#F97316"/);
assert.match(home, /backgroundColor: MMD_BLUE/);
assert.match(camera, /closeMapZoom\(16\)/);

assert.equal(onlineSheetMaxHeightPx(844), Math.round(844 * 0.58));
assert.equal(onlineSheetMaxHeightPx(390), 226);
assert.equal(onlineSheetMaxHeightPx(0), 0);
assert.match(sheet, /onlineSheetMaxHeightPx\(windowHeight\)/);
assert.doesNotMatch(sheet, /maxHeight:\s*"58%"/);
assert.ok(Math.abs(closeMapZoom(13) - (13 + Math.log2(3.5))) < 1e-9);
assert.ok(Math.abs(NAV_CAMERA.zoom - (19.32 - 1.85 + Math.log2(3.5))) < 1e-9);
assert.match(sheet, /#082F49/);
assert.match(sheet, /#0F172A/);
assert.doesNotMatch(sheet, /MMD Smart Dispatch/);
assert.match(sheet, /duration: RADAR_TURN_MS/);
assert.match(sheet, /const RADAR_TURN_MS = 5000/);
assert.match(sheet, /const RADAR_ARC_DELAYS_MS = \[0, 1700, 3400\]/);
assert.match(sheet, /useRadarArcRotation\(spinning, RADAR_ARC_DELAYS_MS\[0\]\)/);
assert.match(sheet, /useRadarArcRotation\(spinning, RADAR_ARC_DELAYS_MS\[1\]\)/);
assert.match(sheet, /useRadarArcRotation\(spinning, RADAR_ARC_DELAYS_MS\[2\]\)/);
assert.match(sheet, /borderTopColor: color/);
assert.match(sheet, /borderRightColor: color/);
assert.match(sheet, /borderColor: "transparent"/);
assert.doesNotMatch(sheet, /radarRingRed|radarRingYellow|radarSweep/);
assert.match(sheet, /<View style=\{styles\.radarCore\} \/>/);
assert.match(sheet, /nextCourseTitle/);
assert.match(sheet, /coursePhase === "searching"/);
assert.match(sheet, /coursePhase === "locating"/);
assert.doesNotMatch(sheet, /onPress=\{_onViewHotspots\}/);
assert.doesNotMatch(sheet, /onPress=\{onViewHotspots\}/);
assert.match(sheet, /actionsRow:\s*\{[^}]*flexDirection:\s*"row"/);
assert.match(sheet, /primaryAction:\s*\{[^}]*flex:\s*1/);
assert.match(sheet, /minWidth:\s*0/);
assert.doesNotMatch(sheet, /actionsRow:\s*\{[^}]*flexDirection:\s*"column"/);

console.log("driverFigmaFrames.regression.test.ts OK");
