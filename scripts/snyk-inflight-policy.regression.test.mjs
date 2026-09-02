/**
 * Ensure .snyk ignores only SNYK-JS-INFLIGHT-6095116 / inflight@1.0.6.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const ROOT = join(import.meta.dirname, "..");
const SNYK = join(ROOT, ".snyk");

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const raw = readFileSync(SNYK, "utf8");

test(".snyk declares policy schema v1.25.0", () => {
  assert.match(raw, /^version: v1\.25\.0$/m);
});

test(".snyk ignores exactly one vulnerability id", () => {
  const ids = [...raw.matchAll(/^\s{2}(SNYK-[A-Z0-9-]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["SNYK-JS-INFLIGHT-6095116"]);
});

test(".snyk scopes ignore to inflight@1.0.6 only", () => {
  assert.match(raw, /^\s{4}- 'inflight@1\.0\.6':$/m);
  assert.doesNotMatch(raw, /^\s{4}- '\*':$/m);
});

test(".snyk documents glob@7 transitive justification", () => {
  assert.match(raw, /glob@7\.2\.3/);
  assert.match(raw, /apps\/mobile\/src/);
  assert.match(raw, /docs\/security\/SNYK-INFLIGHT-IGNORE\.md/);
});

test(".snyk defines no patches and no other ignore ids", () => {
  assert.match(raw, /^patch: \{\}$/m);
  assert.doesNotMatch(raw, /SNYK-JS-(?!INFLIGHT-6095116)/);
});

console.log("snyk inflight policy scope guard passed");
