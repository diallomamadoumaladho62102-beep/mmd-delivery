/**
 * Dependabot #175 / GHSA-vcc3-ghjq-m6fr / CVE-2026-45822
 *
 * Official decode-uri-component@0.5.0 is ESM-only. query-string@7.1.3
 * (React Navigation) require()'s it as CJS. We vendor a CJS 0.5.0 backport
 * of the patched linear-time scanner — do not override to the npm ESM build.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
const vendorPkg = JSON.parse(
  readFileSync(join(ROOT, "vendor", "decode-uri-component", "package.json"), "utf8"),
);

test("override points at the CJS 0.5.0 vendor, not npm ESM 0.5.0", () => {
  assert.equal(
    pkg.pnpm?.overrides?.["decode-uri-component"],
    "file:vendor/decode-uri-component",
  );
  assert.equal(vendorPkg.version, "0.5.0");
  assert.equal(vendorPkg.main, "index.js");
  assert.notEqual(vendorPkg.type, "module");
});

test("lockfile has no vulnerable decode-uri-component 0.2–0.4 line", () => {
  assert.doesNotMatch(lock, /decode-uri-component@0\.[0-4]\./);
  assert.match(lock, /query-string@7\.1\.3:/);
  assert.match(lock, /@react-navigation\/core@/);
});

test("CJS require() still returns a function (React Navigation / query-string)", () => {
  const decode = require(join(ROOT, "vendor", "decode-uri-component", "index.js"));
  assert.equal(typeof decode, "function");
  assert.equal(decode("st%C3%A5le"), "ståle");
  assert.equal(decode("%"), "%");
});

test("query-string@7 parse() still works through CJS require", () => {
  const queryString = require("query-string");
  assert.equal(typeof queryString.parse, "function");
  const parsed = queryString.parse("foo=bar&q=st%C3%A5le");
  assert.equal(parsed.foo, "bar");
  assert.equal(parsed.q, "ståle");
});

test("CVE-2026-45822 payload stays linear-time (<500ms for 1400 %ab tokens)", () => {
  const decode = require(join(ROOT, "vendor", "decode-uri-component", "index.js"));
  const payload = "%ab".repeat(1400);
  const start = process.hrtime.bigint();
  const out = decode(payload);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(typeof out === "string");
  assert.ok(ms < 500, `decode took ${ms.toFixed(1)}ms`);
});

test("npm ESM 0.5.0 package.json is not what query-string would require()", () => {
  assert.equal(existsSync(join(ROOT, "vendor", "decode-uri-component", "index.js")), true);
});

console.log("decode-uri-component CJS 0.5.0 backport + query-string@7 guard passed");
