/**
 * instantCashoutBlockMessage — partner-facing Instant Cash Out reasons.
 */
import assert from "node:assert/strict";
import { instantCashoutBlockMessage } from "./instantCashoutBlockMessage";

function t(key, fallback, opts) {
  if (!opts) return fallback;
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
}

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("settling is not described as cashable", () => {
  const msg = instantCashoutBlockMessage("instant_available_zero", t);
  assert.match(msg, /pending\/settling/i);
  assert.doesNotMatch(msg, /available to cash out now/i);
});

test("missing Instant destination points to Sunday bank", () => {
  const msg = instantCashoutBlockMessage("no_instant_payout_destination", t);
  assert.match(msg, /Instant-eligible/);
  assert.match(msg, /Sunday 4:00 AM ET/);
});

test("already cashed out today is explicit", () => {
  const msg = instantCashoutBlockMessage("already_cashed_out_today", t);
  assert.match(msg, /already requested/i);
});

console.log("instantCashoutBlockMessage tests passed");
