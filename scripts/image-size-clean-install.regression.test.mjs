/**
 * Prove image-size@1.2.1 pnpm patch applies on a clean install.
 * Does not use the existing workspace node_modules.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const ROOT = join(import.meta.dirname, "..");
const PATCH = join(ROOT, "patches", "image-size@1.2.1.patch");
const PKG = join(ROOT, "package.json");
const LOCK = join(ROOT, "pnpm-lock.yaml");

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("repo declares patchedDependencies for image-size@1.2.1", () => {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  assert.equal(
    pkg.pnpm?.patchedDependencies?.["image-size@1.2.1"],
    "patches/image-size@1.2.1.patch",
  );
  assert.equal(pkg.pnpm?.overrides?.["image-size"], "1.2.1");
  const lock = readFileSync(LOCK, "utf8");
  assert.match(lock, /patchedDependencies:\s*\n\s*image-size@1\.2\.1:/);
  assert.match(lock, /path: patches\/image-size@1\.2\.1\.patch/);
  assert.match(lock, /image-size@1\.2\.1\(patch_hash=/);
});

test("patch file contains both CVE guards", () => {
  const patch = readFileSync(PATCH, "utf8");
  assert.match(patch, /CVE-2025-71330/);
  assert.match(patch, /CVE-2025-71329/);
  assert.match(patch, /entryLength < 8/);
  assert.match(patch, /jxlpBox\.size > 0/);
});

const dir = mkdtempSync(join(tmpdir(), "mmd-image-size-clean-"));
mkdirSync(join(dir, "patches"));
cpSync(PATCH, join(dir, "patches", "image-size@1.2.1.patch"));
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify(
    {
      name: "mmd-image-size-clean-install",
      private: true,
      packageManager: "pnpm@10",
      dependencies: { "image-size": "1.2.1" },
      pnpm: {
        overrides: { "image-size": "1.2.1" },
        patchedDependencies: {
          "image-size@1.2.1": "patches/image-size@1.2.1.patch",
        },
      },
    },
    null,
    2,
  ),
);

const install = spawnSync("pnpm", ["install", "--ignore-workspace"], {
  cwd: dir,
  encoding: "utf8",
  shell: true,
  timeout: 180000,
});
if (install.status !== 0) {
  console.error(install.stdout);
  console.error(install.stderr);
  rmSync(dir, { recursive: true, force: true });
  throw new Error("clean pnpm install failed");
}

try {
  const icns = readFileSync(
    join(dir, "node_modules", "image-size", "dist", "types", "icns.js"),
    "utf8",
  );
  const jxl = readFileSync(
    join(dir, "node_modules", "image-size", "dist", "types", "jxl.js"),
    "utf8",
  );
  const pkg = JSON.parse(
    readFileSync(join(dir, "node_modules", "image-size", "package.json"), "utf8"),
  );
  test("clean install version is 1.2.1", () => {
    assert.equal(pkg.version, "1.2.1");
  });
  test("clean install ICNS file contains CVE-2025-71330 guard", () => {
    assert.match(icns, /CVE-2025-71330/);
    assert.match(icns, /entryLength < 8/);
  });
  test("clean install JXL file contains CVE-2025-71329 guard", () => {
    assert.match(jxl, /CVE-2025-71329/);
    assert.match(jxl, /jxlpBox\.size > 0/);
  });
  console.log(
    JSON.stringify(
      {
        clean_install_dir: dir,
        version: pkg.version,
        patched: true,
        official_npm_latest_at_check: "see npm view (expected 2.0.2, still vulnerable)",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("image-size clean-install reproducibility passed");
