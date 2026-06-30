import assert from "node:assert/strict";
import { STREETS_V12_PROTECTED_LAYER_IDS } from "./navigationMapLayers";

const LEGACY_NAV_HIDE_LIST = [
  "route",
  "route-casing",
  "route-line",
  "route-path",
  "road-route",
  "road-path",
  "road-shield-navigation",
  "road-intersection-navigation",
  "road-label-navigation",
  "road-oneway-arrow-blue",
  "road-oneway-arrow-white",
  "turning-feature",
  "turning-feature-outline",
  "guidance",
  "guidance-arrow",
  "navigation-route",
  "navigation-route-casing",
  "navigation-route-line",
  "navigation-path",
];

for (const layerId of STREETS_V12_PROTECTED_LAYER_IDS) {
  assert.ok(
    LEGACY_NAV_HIDE_LIST.includes(layerId),
    `protected layer ${layerId} should be documented in legacy hide list`
  );
}

assert.equal(STREETS_V12_PROTECTED_LAYER_IDS.length, 5);

console.log("navigationMapLayers.test: ok");
