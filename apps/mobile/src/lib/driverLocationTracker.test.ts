import assert from "node:assert/strict";

// Throttle logic mirror — upsertDriverLiveLocation uses module state; we test distance helper.
import { distanceMeters } from "./coordinates";

const driverId = "driver-test";
const t0 = { lat: 48.8566, lng: 2.3522 };
const near = { lat: 48.85661, lng: 2.35221 };
const far = { lat: 48.8600, lng: 2.3522 };

const movedNear = distanceMeters(t0.lat, t0.lng, near.lat, near.lng);
const movedFar = distanceMeters(t0.lat, t0.lng, far.lat, far.lng);

assert.ok(movedNear < 10, "near point under throttle distance");
assert.ok(movedFar > 10, "far point exceeds throttle distance");

console.log("driverLocationTracker.test.ts OK", { driverId, movedNear, movedFar });
