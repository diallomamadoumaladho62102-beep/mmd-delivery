/**
 * Contract: App Store 1.0.1 (89) pin vs HEAD — intentional deltas must stay safe.
 * Pin: 3152ebf28d4da7eb648827c64a7f0a6130dec8c3
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN = "3152ebf28d4da7eb648827c64a7f0a6130dec8c3";

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function showJson(ref, rel) {
  return JSON.parse(
    execSync(`git show ${ref}:${rel}`, { cwd: root, encoding: "utf8" }),
  );
}

const pinApp = showJson(PIN, "apps/mobile/app.json").expo;
const headApp = readJson("apps/mobile/app.json").expo;

assert.equal(pinApp.ios.bundleIdentifier, headApp.ios.bundleIdentifier);
assert.equal(pinApp.ios.version, headApp.ios.version);
assert.equal(pinApp.runtimeVersion, headApp.runtimeVersion);
assert.deepEqual(
  pinApp.ios.entitlements?.["com.apple.developer.in-app-payments"],
  headApp.ios.entitlements?.["com.apple.developer.in-app-payments"],
);
assert.deepEqual(pinApp.ios.associatedDomains, headApp.ios.associatedDomains);
assert.deepEqual(
  pinApp.ios.infoPlist.UIBackgroundModes,
  headApp.ios.infoPlist.UIBackgroundModes,
);
assert.deepEqual(
  pinApp.ios.infoPlist.CFBundleLocalizations,
  headApp.ios.infoPlist.CFBundleLocalizations,
);
assert.equal(pinApp.android.package, headApp.android.package);
assert.equal(pinApp.scheme, headApp.scheme);

const freeze = fs.readFileSync(
  path.join(root, "scripts/assert-store89-ota-freeze.mjs"),
  "utf8",
);
assert.match(freeze, /STORE_BUILD = "89"/);
assert.match(freeze, /runtimeVersion/);

console.log("store89-main-compat.regression.test.mjs OK");
