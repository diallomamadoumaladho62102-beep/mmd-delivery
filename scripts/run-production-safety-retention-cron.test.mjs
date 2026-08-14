/**
 * Smoke test: safety retention cron script is wired for retries (no live HTTP).
 * Run: node scripts/run-production-safety-retention-cron.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(
  path.join(__dirname, "run-production-safety-retention-cron.mjs"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "production-safety-retention-cron.yml"),
  "utf8",
);

assert.match(script, /CRON_FETCH_MAX_ATTEMPTS/);
assert.match(script, /Retrying in/);
assert.match(script, /maxAttempts/);
assert.match(script, /1500 \* attempt/);
assert.match(workflow, /timeout-minutes:\s*10/);
assert.match(workflow, /CRON_FETCH_MAX_ATTEMPTS:\s*"3"/);

assert.equal(evaluateCronHttpResult(200, '{"ok":true}').ok, true);
assert.equal(evaluateCronHttpResult(500, "upstream connect error").ok, false);
assert.equal(evaluateCronHttpResult(401, '{"error":"Unauthorized"}').ok, false);

console.log("run-production-safety-retention-cron.test.mjs OK");
