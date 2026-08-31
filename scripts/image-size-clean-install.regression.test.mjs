/**
 * Prove image-size is gone from the workspace graph (Metro 0.83.8 vendored
 * parsers) while Expo 54 / RN 0.81.5 and the Apple #121 fail-open stay put.
 *
 * The on-disk patch at patches/image-size@1.2.1.patch is kept as a fallback
 * only — it is no longer in pnpm.patchedDependencies because image-size is
 * not installed.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const ROOT = join(import.meta.dirname, "..");
const PATCH = join(ROOT, "patches", "image-size@1.2.1.patch");
const PKG = join(ROOT, "package.json");
const MOBILE_PKG = join(ROOT, "apps", "mobile", "package.json");
const LOCK = join(ROOT, "pnpm-lock.yaml");
const BOOT = join(ROOT, "apps", "mobile", "src", "lib", "bootFailOpen.ts");
const HOME = join(ROOT, "apps", "mobile", "src", "screens", "ClientHomeScreen.tsx");

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const pkg = JSON.parse(readFileSync(PKG, "utf8"));
const mobile = JSON.parse(readFileSync(MOBILE_PKG, "utf8"));
const lock = readFileSync(LOCK, "utf8");

test("Expo 54 and React Native 0.81.5 are unchanged", () => {
  assert.match(String(pkg.dependencies.expo), /~54\./);
  assert.equal(pkg.dependencies["react-native"], "0.81.5");
  assert.match(String(mobile.dependencies.expo), /~54\./);
  assert.equal(mobile.dependencies["react-native"], "0.81.5");
});

test("pnpm overrides pin the Metro 0.83.8 family", () => {
  assert.equal(pkg.pnpm?.overrides?.metro, "0.83.8");
  assert.equal(pkg.pnpm?.overrides?.["metro-config"], "0.83.8");
  assert.equal(pkg.pnpm?.overrides?.["metro-runtime"], "0.83.8");
  assert.equal(pkg.pnpm?.patchedDependencies?.["image-size@1.2.1"], undefined);
  assert.equal(pkg.pnpm?.overrides?.["image-size"], undefined);
});

test("lockfile installs metro@0.83.8 and no image-size package", () => {
  assert.match(lock, /^ {2}metro@0\.83\.8:/m);
  assert.doesNotMatch(lock, /metro@0\.83\.[0-7]:/);
  assert.doesNotMatch(lock, /image-size@/);
  assert.doesNotMatch(lock, /image-size:/);
});

/**
 * pnpm on GitHub CI does not hoist metro to node_modules/metro.
 * Resolve the installed package.json from the virtual store without require().
 */
function findInstalledMetroPackageJson() {
  const candidates = [
    join(ROOT, "node_modules", "metro", "package.json"),
    join(ROOT, "apps", "mobile", "node_modules", "metro", "package.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const pnpmDir = join(ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return null;

  for (const name of readdirSync(pnpmDir)) {
    const candidate = join(
      pnpmDir,
      name,
      "node_modules",
      "metro",
      "package.json",
    );
    if (!existsSync(candidate)) continue;
    try {
      const probe = JSON.parse(readFileSync(candidate, "utf8"));
      if (probe.name === "metro" && probe.version === "0.83.8") return candidate;
    } catch {
      /* ignore unreadable store entries */
    }
  }
  return null;
}

test("installed metro is 0.83.8 and does not depend on image-size", () => {
  const metroPkgPath = findInstalledMetroPackageJson();
  assert.ok(
    metroPkgPath,
    "metro@0.83.8 not found in node_modules or the pnpm virtual store",
  );
  const metroPkg = JSON.parse(readFileSync(metroPkgPath, "utf8"));
  assert.equal(metroPkg.version, "0.83.8");
  assert.equal(metroPkg.dependencies?.["image-size"], undefined);
  assert.equal(existsSync(join(ROOT, "node_modules", "image-size")), false);
});

test("fallback image-size patch file still exists with both CVE guards", () => {
  assert.equal(existsSync(PATCH), true);
  const patch = readFileSync(PATCH, "utf8");
  assert.match(patch, /CVE-2025-71330/);
  assert.match(patch, /CVE-2025-71329/);
  assert.match(patch, /entryLength < 8/);
  assert.match(patch, /jxlpBox\.size > 0/);
});

test("Apple #121 Client Home fail-open is intact", () => {
  const boot = readFileSync(BOOT, "utf8");
  const home = readFileSync(HOME, "utf8");
  assert.match(boot, /CLIENT_HOME_FETCH_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(home, /CLIENT_HOME_FETCH_TIMEOUT_MS/);
  assert.match(home, /client_home_fetch/);
});

test("inflight remains a glob@7 build-time leaf (no app import)", () => {
  assert.match(lock, /inflight@1\.0\.6:/);
  assert.match(lock, /glob@7\.2\.3:/);
  const mmdAudio = readFileSync(
    join(ROOT, "apps", "mobile", "src", "lib", "mmdAudio.ts"),
    "utf8",
  );
  const clientHome = readFileSync(HOME, "utf8");
  assert.doesNotMatch(mmdAudio, /inflight/);
  assert.doesNotMatch(clientHome, /inflight/);
});

console.log("metro 0.83.8 image-size removal + Apple #121 guard passed");
