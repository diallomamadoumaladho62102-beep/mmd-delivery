/**
 * Six open Dependabot moderate alerts — individual conclusions.
 * This file pins patched floors. It does not hide, mute, or disable audits.
 *
 * #180 js-yaml GHSA-r3ph-w7gj-g6xm (DoS via empty merge keys)
 *   Introduced by: @expo/xcpretty (Expo CLI), @istanbuljs/load-nyc-config (Jest),
 *   @eslint/eslintrc (dev lint). Not on the Next.js request path.
 *   Production reachability: none. No user YAML is parsed by MMD web APIs.
 *   Safe update applied: 5.2.2 → 5.4.2 (patched >=5.4.1).
 *
 * #181 fast-uri GHSA-jvvf-x445-j334 (mailto percent-encoding injection)
 *   Introduced by: ajv (schema tooling / expo-build-properties).
 *   Production reachability: none. MMD does not parse untrusted mailto URIs
 *   with fast-uri on live payment or delivery routes.
 *   Safe update applied: 4.1.4 → 4.2.1 (patched >=4.1.5).
 *
 * #182 fast-uri GHSA-hrr3-gc8f-f4qj (scheme-relative host case evasion)
 *   Same introducer and reachability as #181.
 *   Safe update applied: same 4.2.1 pin.
 *
 * #183 brace-expansion GHSA-q2hr-2g5m-vwhr range >=4 <5.0.12
 *   Introduced by: minimatch@10 / @isaacs/brace-expansion (Expo CLI / glob).
 *   Production reachability: none. No untrusted glob expand on request path.
 *   Safe update applied: 5.0.11 → 5.0.12.
 *
 * #184 brace-expansion GHSA-q2hr-2g5m-vwhr range >=2 <2.1.7
 *   Introduced by: minimatch@9 (glob / Expo CLI).
 *   Production reachability: none.
 *   Safe update applied: 2.1.6 → 2.1.7.
 *
 * #185 brace-expansion GHSA-q2hr-2g5m-vwhr range <1.1.21
 *   Introduced by: minimatch@3 (Jest / ESLint / glob).
 *   Production reachability: none.
 *   Safe update applied: 1.1.20 → 1.1.21.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const overrides = pkg.pnpm?.overrides ?? {};

assert.ok(
  String(overrides["js-yaml@5.2.2"]).includes("5.4.2") ||
    String(overrides["js-yaml@>=5.0.0 <5.4.1"]).includes("5.4.2"),
  "js-yaml 5.2.2 must be forced to 5.4.2"
);
assert.ok(String(overrides["fast-uri"]).includes("4.1.5"), "fast-uri override must be >=4.1.5");
assert.equal(overrides["brace-expansion@1"], "1.1.21");
assert.equal(overrides["brace-expansion@2"], "2.1.7");
assert.ok(String(overrides["minimatch@10>brace-expansion"]).includes("5.0.12"));
assert.ok(String(overrides["@isaacs/brace-expansion"]).includes("5.0.12"));

assert.equal(
  /js-yaml@5\.2\.2:\r?\n/.test(lock),
  false,
  "lock must not resolve a js-yaml 5.2.2 package"
);
assert.equal(lock.includes("js-yaml@5.4.2:"), true, "lock must resolve js-yaml 5.4.2");
assert.equal(/fast-uri@4\.1\.4:\r?\n/.test(lock), false, "lock must not resolve fast-uri 4.1.4");
assert.equal(lock.includes("fast-uri@4.2.1:"), true, "lock must resolve fast-uri 4.2.1");
assert.equal(/brace-expansion@1\.1\.20:\r?\n/.test(lock), false);
assert.equal(/brace-expansion@2\.1\.6:\r?\n/.test(lock), false);
assert.equal(/brace-expansion@5\.0\.11:\r?\n/.test(lock), false);
assert.equal(lock.includes("brace-expansion@1.1.21:"), true);
assert.equal(lock.includes("brace-expansion@2.1.7:"), true);
assert.equal(lock.includes("brace-expansion@5.0.12:"), true);

console.log("moderate-advisory-overrides.regression.test.mjs OK");
console.log(
  JSON.stringify(
    {
      alerts: [
        { id: 180, pkg: "js-yaml", ghsa: "GHSA-r3ph-w7gj-g6xm", patched: "5.4.2", reachable_prod: false },
        { id: 181, pkg: "fast-uri", ghsa: "GHSA-jvvf-x445-j334", patched: "4.2.1", reachable_prod: false },
        { id: 182, pkg: "fast-uri", ghsa: "GHSA-hrr3-gc8f-f4qj", patched: "4.2.1", reachable_prod: false },
        { id: 183, pkg: "brace-expansion", ghsa: "GHSA-q2hr-2g5m-vwhr", patched: "5.0.12", reachable_prod: false },
        { id: 184, pkg: "brace-expansion", ghsa: "GHSA-q2hr-2g5m-vwhr", patched: "2.1.7", reachable_prod: false },
        { id: 185, pkg: "brace-expansion", ghsa: "GHSA-q2hr-2g5m-vwhr", patched: "1.1.21", reachable_prod: false },
      ],
    },
    null,
    2
  )
);
