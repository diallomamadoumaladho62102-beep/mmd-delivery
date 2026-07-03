import assert from "node:assert/strict";
import test from "node:test";
import { formatTimer, formatWaitFee } from "./waitTimerFormat";

test("formatTimer renders mm:ss", () => {
  assert.equal(formatTimer(0), "00:00");
  assert.equal(formatTimer(65), "01:05");
  assert.equal(formatTimer(-5), "00:00");
});

test("formatWaitFee formats currency safely", () => {
  const formatted = formatWaitFee(225, "USD");
  assert.ok(formatted.includes("2.25") || formatted.includes("2,25"));
  assert.ok(formatWaitFee(0, "USD").includes("0"));
});
