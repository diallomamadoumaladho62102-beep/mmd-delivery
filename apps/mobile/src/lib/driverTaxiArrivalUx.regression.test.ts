/**
 * Regression: Driver arrival panel is top-anchored under Safe Area,
 * and client meeting coords never invent live GPS.
 */
import assert from "node:assert/strict";
import { resolveOverlayInsets } from "./navigationSafeArea";
import { resolveClientMeetingPoint } from "./driverTaxiClientDisplay";

const iphone = resolveOverlayInsets({ top: 59, bottom: 34, left: 0, right: 0 });
assert.ok(iphone.arrivalBannerTop > 59, "arrival top clears Dynamic Island");
assert.equal(
  iphone.arrivalBannerTop,
  iphone.statusBannerTop,
  "arrival shares top band with status (not bottom speed chrome)",
);

const ipad = resolveOverlayInsets({ top: 24, bottom: 20, left: 0, right: 0 });
assert.ok(ipad.arrivalBannerTop > 24, "iPad arrival clears status bar");

assert.ok(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: 40.7,
    pickupLng: -73.9,
  }),
  "valid pickup shows meeting pin",
);
assert.equal(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: 0,
    pickupLng: 0,
  }),
  null,
  "0,0 never shown as client",
);

console.log("driverTaxiArrivalUx regression tests passed");
