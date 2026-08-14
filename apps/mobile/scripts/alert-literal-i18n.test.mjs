/**
 * Regression guard: no Alert.alert("literal") user titles in mobile src.
 * Run: node apps/mobile/scripts/alert-literal-i18n.test.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audit = path.join(__dirname, "audit-hardcoded-ui-text.mjs");

const result = spawnSync(process.execPath, [audit], {
  encoding: "utf8",
  cwd: path.join(__dirname, "..", "..", ".."),
});

process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");

if (result.status !== 0) {
  console.error("FAIL: alert-literal-i18n regression");
  process.exit(result.status || 1);
}

console.log("PASS: alert-literal-i18n regression");
