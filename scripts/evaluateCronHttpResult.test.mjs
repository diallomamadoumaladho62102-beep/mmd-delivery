import assert from "node:assert/strict";
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

test("HTTP 401 is failure", () => {
  const result = evaluateCronHttpResult(401, '{"error":"Unauthorized"}');
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_401");
});

test("HTTP 500 is failure", () => {
  const result = evaluateCronHttpResult(500, '{"ok":false}');
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_500");
});

test("HTTP 200 with ok:false is failure", () => {
  const result = evaluateCronHttpResult(200, '{"ok":false,"error":"lock_busy"}');
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ok_false");
});

test("HTTP 200 with success:false is failure", () => {
  const result = evaluateCronHttpResult(200, '{"success":false}');
  assert.equal(result.ok, false);
  assert.equal(result.reason, "success_false");
});

test("HTTP 200 with invalid JSON is failure", () => {
  const result = evaluateCronHttpResult(200, "not-json");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_json_body");
});

test("HTTP 200 with ok:true is success", () => {
  const result = evaluateCronHttpResult(200, '{"ok":true,"canceled":0}');
  assert.equal(result.ok, true);
});

test("HTTP 204 empty body is success", () => {
  const result = evaluateCronHttpResult(204, "");
  assert.equal(result.ok, true);
});

test("HTTP 200 without ok field is success", () => {
  const result = evaluateCronHttpResult(200, '{"expired":1}');
  assert.equal(result.ok, true);
});

test("HTTP 200 empty body is success", () => {
  const result = evaluateCronHttpResult(200, "");
  assert.equal(result.ok, true);
});

test("HTTP 200 with whitespace-only body is success", () => {
  const result = evaluateCronHttpResult(200, "   ");
  assert.equal(result.ok, true);
});

test("HTTP 502 is failure", () => {
  const result = evaluateCronHttpResult(502, "Bad Gateway");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_502");
});

console.log("evaluateCronHttpResult tests passed");
