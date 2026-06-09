/**
 * Smoke test — platform launch control helper (no network).
 * Run: npx tsx apps/web/scripts/smoke-platform-launch.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

function run(label, scriptPath) {
  const res = spawnSync("npx", ["tsx", scriptPath], {
    cwd: webRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: true,
  });
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
    throw new Error(`${label} failed`);
  }
  console.log(res.stdout.trim());
}

run("platformLaunchControl unit tests", path.join(webRoot, "src/lib/platformLaunchControl.test.ts"));

assert.ok(true, "smoke-platform-launch passed");
console.log("smoke-platform-launch ALL PASS");
