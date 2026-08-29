#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

assert.ok(existsSync(join(root, ".github/workflows/codeql.yml")));
assert.ok(existsSync(join(root, ".github/workflows/semgrep.yml")));
assert.ok(existsSync(join(root, ".github/workflows/owasp-zap.yml")));
assert.ok(existsSync(join(root, ".github/dependabot.yml")));
assert.ok(existsSync(join(root, "scripts/secret-scan.mjs")));
assert.ok(existsSync(join(root, "scripts/dependency-audit.mjs")));
assert.ok(existsSync(join(root, ".semgrep/mmd-security.yml")));

const ci = read(".github/workflows/ci.yml");
assert.match(ci, /permissions:\s*\n\s+contents: read/);
assert.match(ci, /node scripts\/secret-scan\.mjs/);
assert.match(ci, /node scripts\/dependency-audit\.mjs/);

const codeql = read(".github/workflows/codeql.yml");
assert.match(codeql, /security-extended/);
assert.match(codeql, /javascript-typescript/);

const zap = read("scripts/owasp-zap-baseline.mjs");
assert.match(zap, /www\.mmddelivery\.com/);
assert.match(zap, /production hosts are not allowed/);

console.log("security-layers.regression.test.mjs OK");
