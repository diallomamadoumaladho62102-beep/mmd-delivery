import {
  estimateMarkerAnimationDurationMs,
  interpolateAngle,
  interpolateCoordinate,
  shortestAngleDelta,
} from "./markerAnimation";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(Math.abs(shortestAngleDelta(359, 1) - 2) < 0.001, "359→1 is +2°");
assert(Math.abs(shortestAngleDelta(1, 359) + 2) < 0.001, "1→359 is -2°");

const mid = interpolateAngle(359, 1, 0.5);
assert(Math.abs(mid - 0) < 0.001 || Math.abs(mid - 360) < 0.001, "mid angle on short arc");

const from = { latitude: 40.75, longitude: -73.99 };
const toNear = { latitude: 40.75045, longitude: -73.98955 };
const half = interpolateCoordinate(from, toNear, 0.5);
assert(half.latitude > from.latitude && half.latitude < toNear.latitude, "lat interpolated");

const fast = estimateMarkerAnimationDurationMs({
  from,
  to: toNear,
  speedMps: 12,
});
const slow = estimateMarkerAnimationDurationMs({
  from,
  to: toNear,
  speedMps: 2,
});
assert(fast < slow, "higher speed → shorter animation");
assert(fast >= 350 && slow <= 8000, "duration stays within bounds");

console.log("markerAnimation.test.ts — PASS");
