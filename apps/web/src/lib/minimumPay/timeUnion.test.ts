import assert from "node:assert/strict";
import test from "node:test";
import {
  clipInterval,
  durationSeconds,
  subtractIntervals,
  unionIntervals,
} from "./timeUnion";

const origin = Date.parse("2000-01-01T10:00:00.000Z");

function iv(startMin: number, endMin: number) {
  return {
    startedAtMs: origin + startMin * 60_000,
    endedAtMs: origin + endMin * 60_000,
  };
}

test("overlapping trips are unioned not summed", () => {
  const seconds = durationSeconds([iv(0, 30), iv(15, 45)]);
  assert.equal(seconds, 45 * 60);
});

test("adjacent intervals merge", () => {
  const merged = unionIntervals([iv(0, 30), iv(30, 45)]);
  assert.equal(merged.length, 1);
  assert.equal(durationSeconds(merged), 45 * 60);
});

test("identical intervals count once", () => {
  assert.equal(durationSeconds([iv(0, 30), iv(0, 30)]), 30 * 60);
});

test("nested intervals count the outer span only", () => {
  assert.equal(durationSeconds([iv(0, 60), iv(10, 20)]), 60 * 60);
});

test("separate intervals sum", () => {
  assert.equal(durationSeconds([iv(0, 10), iv(20, 30)]), 20 * 60);
});

test("clip keeps only the period overlap", () => {
  const clipped = clipInterval(iv(0, 60), origin + 15 * 60_000, origin + 45 * 60_000);
  assert.ok(clipped);
  assert.equal(durationSeconds([clipped]), 30 * 60);
});

test("on-call minus trip removes the overlapping minutes", () => {
  const leftover = subtractIntervals([iv(0, 60)], [iv(10, 40)]);
  assert.equal(durationSeconds(leftover), 30 * 60);
});
