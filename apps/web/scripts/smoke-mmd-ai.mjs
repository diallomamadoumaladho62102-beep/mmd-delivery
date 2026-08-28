/**
 * Smoke test — MMD AI Phase 1.5 helpers (no network).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

const res = spawnSync("npx", ["tsx", "src/lib/ai/aiPhase15.test.ts"], {
  cwd: webRoot,
  encoding: "utf8",
  stdio: "pipe",
  shell: true,
});

if (res.status !== 0) {
  console.error(res.stdout);
  console.error(res.stderr);
  process.exit(1);
}

console.log(res.stdout.trim());

for (const file of [
  "src/lib/ai/aiContextBuilders.test.ts",
  "src/lib/ai/aiClientTools.regression.test.ts",
  "src/lib/ai/searchMmdHelp.test.ts",
]) {
  const extra = spawnSync("npx", ["tsx", file], {
    cwd: webRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: true,
  });
  if (extra.status !== 0) {
    console.error(extra.stdout);
    console.error(extra.stderr);
    process.exit(extra.status || 1);
  }
  console.log(extra.stdout.trim());
}
assert.ok(true, "smoke-mmd-ai passed");
console.log("smoke-mmd-ai ALL PASS");
