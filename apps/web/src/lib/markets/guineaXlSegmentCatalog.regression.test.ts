import assert from "node:assert/strict";
import { XL_SEGMENT_LOCAL_ESTIMATES } from "./guineaXlSegmentCatalog";
import {
  XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED,
  priceXlSegment,
  type XlSegmentTariff,
} from "./guineaXlSegments";

const tariff: XlSegmentTariff = {
  version: 1,
  baseGnf: 1_000,
  perKmGnf: 500,
  perMinuteGnf: 100,
  minimumGnf: 30_000,
};

const expected = [
  ["1", "Conakry", "Kindia", "trunk", 128, 102, 75_200],
  ["2", "Kindia", "Mamou", "trunk", 134, 109, 78_900],
  ["3", "Mamou", "Dalaba", "trunk", 54, 75, 35_500],
  ["4", "Dalaba", "Pita", "trunk", 54, 42, 32_200],
  ["5", "Pita", "Labé", "trunk", 40, 32, 30_000],
  ["6", "Labé", "Yembering", "trunk", 70, 120, 48_000],
  ["7", "Yembering", "Dougountounny", "dougountounny", 40, 61, 30_000],
  ["8", "Yembering", "Mali Centre", "mali", 40, 180, 39_000],
] as const;

assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
assert.equal(XL_SEGMENT_LOCAL_ESTIMATES.length, 8);
assert.equal(XL_SEGMENT_LOCAL_ESTIMATES.filter((segment) => segment.confirmed).length, 0);

for (const [code, origin, destination, branch, km, minutes, fare] of expected) {
  const segment = XL_SEGMENT_LOCAL_ESTIMATES.find((item) => item.code === code);
  assert.ok(segment, code);
  assert.equal(segment.originLabel, origin);
  assert.equal(segment.destinationLabel, destination);
  assert.equal(segment.branch, branch);
  assert.equal(segment.distanceKm, km);
  assert.equal(segment.durationMinutes, minutes);
  assert.equal(segment.confirmed, false);
  const priced = priceXlSegment({ distanceKm: km, durationMinutes: minutes, tariff });
  assert.equal(priced.ok, true);
  if (priced.ok) assert.equal(priced.finalGnf, fare);
}

const branch7 = XL_SEGMENT_LOCAL_ESTIMATES.find((segment) => segment.code === "7");
const branch8 = XL_SEGMENT_LOCAL_ESTIMATES.find((segment) => segment.code === "8");
assert.notEqual(branch7?.destinationLabel, branch8?.destinationLabel);
assert.notEqual(branch7?.branch, branch8?.branch);

console.log("guineaXlSegmentCatalog.regression.test.ts OK");
