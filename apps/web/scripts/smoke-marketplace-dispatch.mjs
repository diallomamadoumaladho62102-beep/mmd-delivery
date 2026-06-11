#!/usr/bin/env node
/**
 * Run: npm run test:marketplace-dispatch
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

function run(label, args) {
  const result = spawnSync("npx", args, {
    cwd: webRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`FAIL ${label}`);
    process.exit(result.status ?? 1);
  }
}

run("marketplaceDispatchService.test", [
  "tsx",
  "src/lib/marketplaceDispatchService.test.ts",
]);
run("marketplaceDispatchSmoke.integration", [
  "tsx",
  "src/lib/marketplaceDispatchSmoke.integration.ts",
]);

console.log("test:marketplace-dispatch ALL PASS");
