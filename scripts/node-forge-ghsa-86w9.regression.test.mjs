/**
 * GHSA-86w9-cpqp-85rv / CVE-2026-85393
 *
 * Official node-forge latest is still 1.4.0 (vulnerable). GitHub advisory
 * first_patched_version is null. We vendor 1.4.0 + digitalbazaar/forge#1152
 * as 1.4.1 so Expo CLI / expo-updates keep working without the GHSA range.
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
const mobile = JSON.parse(
  readFileSync(join(ROOT, "apps", "mobile", "package.json"), "utf8"),
);
const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
const vendorPkg = JSON.parse(
  readFileSync(join(ROOT, "vendor", "node-forge", "package.json"), "utf8"),
);
const rsa = readFileSync(join(ROOT, "vendor", "node-forge", "lib", "rsa.js"), "utf8");

test("overrides point at the vendored 1.4.1 backport, not npm 1.4.0", () => {
  assert.equal(pkg.pnpm?.overrides?.["node-forge"], "file:vendor/node-forge");
  assert.equal(mobile.overrides?.["node-forge"], "file:vendor/node-forge");
  assert.equal(vendorPkg.name, "node-forge");
  assert.equal(vendorPkg.version, "1.4.1");
  assert.equal(vendorPkg.main, "lib/index.js");
});

test("lockfile has no npm node-forge@<=1.4.0 resolution", () => {
  assert.doesNotMatch(lock, /node-forge@1\.4\.0:/);
  assert.doesNotMatch(lock, /node-forge@1\.3\./);
  assert.match(lock, /node-forge@file:vendor\/node-forge/);
});

test("vendor rsa.js contains the nested DigestAlgorithm length check", () => {
  assert.match(rsa, /CVE-2026-85393/);
  assert.match(rsa, /obj\.value\[0\]\.value\.length/);
  assert.match(rsa, /\(\('parameters' in capture\) \? 2 : 1\)/);
});

test("vendored node-forge still loads for Expo CLI / code-signing", () => {
  const forge = require(join(ROOT, "vendor", "node-forge", "lib", "index.js"));
  assert.equal(typeof forge.pki.rsa.setPublicKey, "function");
  assert.equal(typeof forge.md.sha256.create, "function");
  const md = forge.md.sha256.create();
  md.update("mmd");
  assert.equal(md.digest().toHex().length, 64);
  const expoCli = join(ROOT, "node_modules", "@expo", "cli");
  if (existsSync(join(expoCli, "package.json"))) {
    const resolved = require.resolve("node-forge", { paths: [expoCli] });
    const resolvedRoot = join(resolved, "..", "..");
    const resolvedPkg = JSON.parse(
      readFileSync(join(resolvedRoot, "package.json"), "utf8"),
    );
    assert.equal(resolvedPkg.version, "1.4.1");
    assert.match(
      readFileSync(join(resolvedRoot, "lib", "rsa.js"), "utf8"),
      /CVE-2026-85393/,
    );
  }
});

test("CVE-2026-85393 nested DigestAlgorithm garbage is rejected", () => {
  const forge = require(join(ROOT, "vendor", "node-forge", "lib", "index.js"));
  // Vectors from digitalbazaar/forge#1152 (same N/e as tests/unit/rsa.js).
  const N = new forge.jsbn.BigInteger(
    "E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE56" +
      "47670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A8" +
      "86A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED7" +
      "8F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A" +
      "5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CE" +
      "CC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE5" +
      "4844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6AB" +
      "E252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7",
    16,
  );
  const e = new forge.jsbn.BigInteger("3");
  const publicKey = forge.pki.rsa.setPublicKey(N, e);
  const S = forge.util.binary.hex.decode(
    "a4ae63dd5e7712b78f4870d0f51e294df5503d4f16c5d27ae33370981fb57f0de49f" +
      "50f3d6a04666774cd984cd13972db9bf8e12bd294ef0ddc916c7c86cbae63efd7b6b" +
      "97885e69760c208a40f1aecc76a90d7af5145177efce1bb55807a8d05c20b1596753" +
      "ba710642fc9acdde6c160232654662c77cc4466c8257a38edb49f894e8845d0fd987" +
      "b857ced88f4b62505a080bd87ef700d35d392a6e8f6fde34250c50b86fae606cb551" +
      "215e8f4813239b77651d5565ad453698c071d48c31e8e526fb4a37610f64b3e1fb8e" +
      "5be5898e408ad08197a0947794a530b54f84485377ce4a7488ed485ce4e5e105dd89" +
      "698a472f390c3b1b76bc16b73276c4d1c81d",
  );
  const md = forge.md.sha256.create();
  md.update("hello world!");
  assert.throws(
    () =>
      publicKey.verify(md.digest().getBytes(), S, undefined, {
        _skipPaddingChecks: true,
      }),
    /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value/,
  );
});

console.log("node-forge GHSA-86w9-cpqp-85rv vendor 1.4.1 backport guard passed");
