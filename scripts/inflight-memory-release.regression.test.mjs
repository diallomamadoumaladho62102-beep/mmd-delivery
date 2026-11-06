/**
 * SNYK-JS-INFLIGHT-6095116
 *
 * npm inflight@1.0.6 is the only registry release and leaks pending callbacks.
 * glob@7.2.3 (React Native 0.81 codegen) still needs the callback API.
 * This test loads the inflight copy those packages resolve.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

if (typeof global.gc !== "function") {
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", join(ROOT, "scripts", "inflight-memory-release.regression.test.mjs")],
    { stdio: "inherit", cwd: ROOT },
  );
  process.exit(child.status ?? 1);
}

const require = createRequire(import.meta.url);

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
const source = readFileSync(join(ROOT, "vendor", "inflight", "inflight.js"), "utf8");
const vendorPkg = JSON.parse(readFileSync(join(ROOT, "vendor", "inflight", "package.json"), "utf8"));

await test("override replaces npm inflight and keeps glob@7", () => {
  assert.equal(pkg.pnpm?.overrides?.inflight, "file:vendor/inflight");
  assert.equal(pkg.dependencies?.expo, "~54.0.36");
  assert.equal(pkg.dependencies?.["react-native"], "0.81.5");
  assert.equal(vendorPkg.version, "1.0.7");
  assert.match(source, /FinalizationRegistry/);
  assert.match(source, /SNYK-JS-INFLIGHT-6095116/);
  assert.doesNotMatch(lock, /inflight@1\.0\.6:/);
  assert.match(lock, /inflight@file:vendor\/inflight/);
  assert.match(lock, /glob@7\.2\.3:/);
});

function loadFrom(packageJson) {
  const local = createRequire(packageJson);
  const resolved = local.resolve("inflight");
  assert.equal(readFileSync(resolved, "utf8"), source);
  return local("inflight");
}

const inflight = loadFrom(join(ROOT, "node_modules", "react-native", "package.json"));

await test("codegen and glob@7 resolve the same patched inflight", () => {
  loadFrom(join(ROOT, "node_modules", "@react-native", "codegen", "package.json"));
  loadFrom(join(ROOT, "node_modules", "react-native", "node_modules", "glob", "package.json"));
  const middleware = createRequire(
    join(ROOT, "node_modules", "@react-native", "dev-middleware", "package.json"),
  );
  loadFrom(middleware.resolve("rimraf/package.json"));
});

await test("glob@7 join and completion behavior is unchanged", () => {
  const seen = [];
  const first = inflight("stat-key", (value) => seen.push(["first", value]));
  const joined = inflight("stat-key", (value) => seen.push(["joined", value]));
  assert.equal(typeof first, "function");
  assert.equal(joined, null);
  first("ok");
  assert.deepEqual(seen, [
    ["first", "ok"],
    ["joined", "ok"],
  ]);
  const again = inflight("stat-key", () => {});
  assert.equal(typeof again, "function");
  again();
});

await test("a dropped inflight function releases its slot", async () => {
  function drop() {
    inflight("dropped-key", () => {
      throw new Error("dropped callback must not stay reachable");
    });
  }
  drop();
  let released = null;
  for (let i = 0; i < 10 && typeof released !== "function"; i += 1) {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
    const probe = inflight("dropped-key", () => {});
    if (typeof probe === "function") {
      released = probe;
      break;
    }
  }
  assert.equal(typeof released, "function");
  released();
});

await test("three waiters on one key all receive the same arguments", () => {
  const seen = [];
  const first = inflight("multi", (error, value) => seen.push(["a", error, value]));
  const second = inflight("multi", (error, value) => seen.push(["b", error, value]));
  const third = inflight("multi", (error, value) => seen.push(["c", error, value]));
  assert.equal(typeof first, "function");
  assert.equal(second, null);
  assert.equal(third, null);
  const failure = new Error("stat failed");
  first(failure, null);
  assert.equal(seen.length, 3);
  for (const row of seen) {
    assert.equal(row[1], failure);
    assert.equal(row[2], null);
  }
  assert.equal(typeof inflight("multi", () => {}), "function");
});

await test("a throwing callback still releases the key", () => {
  const first = inflight("throws", () => {
    throw new Error("callback failed");
  });
  inflight("throws", () => {});
  assert.throws(() => first(), /callback failed/);
  const again = inflight("throws", () => {});
  assert.equal(typeof again, "function");
  again();
});

await test("a callback that joins the same key during completion still runs", async () => {
  const seen = [];
  const first = inflight("reenter", () => {
    seen.push("first");
    const joined = inflight("reenter", () => seen.push("late"));
    assert.equal(joined, null);
  });
  first();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["first", "late"]);
  assert.equal(typeof inflight("reenter", () => {}), "function");
});

await test("jest test-exclude resolves the patched inflight", () => {
  const jestRequire = createRequire(
    join(ROOT, "node_modules", "babel-plugin-istanbul", "package.json"),
  );
  loadFrom(jestRequire.resolve("test-exclude/package.json"));
});

await test("react-native glob@7 still lists package.json", () => {
  const glob = createRequire(join(ROOT, "node_modules", "react-native", "package.json"))("glob");
  const files = glob.sync("package.json", { cwd: ROOT });
  assert.ok(files.includes("package.json"));
});

console.log("inflight-memory-release.regression.test.mjs OK");
