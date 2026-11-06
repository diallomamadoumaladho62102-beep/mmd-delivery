/**
 * @react-native/codegen@0.81.5 used glob@7, which reads minimatch 3's
 * pattern._glob. The workspace resolves minimatch 11.0.4, so glob.sync threw
 * "Cannot read properties of undefined (reading 'charAt')" while Sentry's
 * Android codegen scanned **\/*{,.fb}.{js,ts,tsx}.
 *
 * The pnpm patch walks the directory for the same extensions. This test fails
 * if that walk is removed or if the CLI crashes again.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const source = readFileSync(
  join(
    root,
    "node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema.js",
  ),
  "utf8",
);
const patch = readFileSync(
  join(root, "patches/@react-native__codegen@0.81.5.patch"),
  "utf8",
);

assert.match(source, /CODEGEN_SOURCE/);
assert.doesNotMatch(source, /glob\.sync\(/);
assert.match(patch, /CODEGEN_SOURCE/);
assert.match(
  readFileSync(join(root, "package.json"), "utf8"),
  /@react-native\/codegen@0\.81\.5/,
);

const dir = mkdtempSync(join(tmpdir(), "mmd-codegen-"));
try {
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested", "plain.js"), "export const value = 1;\n");
  writeFileSync(join(dir, "nested", "plain.fb.ts"), "export const other = 2;\n");
  writeFileSync(join(dir, "skip.txt"), "not a source");
  const out = join(dir, "schema.json");
  const cli = join(
    root,
    "node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js",
  );
  const result = spawnSync(
    process.execPath,
    [cli, "--platform", "android", "--exclude", "NativeSampleTurboModule", out, dir],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `codegen cli failed\n${result.stdout}\n${result.stderr}`,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(combined, /charAt/);
  assert.equal(readFileSync(out, "utf8").includes("{"), true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("codegen-minimatch-11.regression.test.mjs OK");
