#!/usr/bin/env node
/**
 * Phase 8 — dependency audit (high/critical). Prints summary only.
 * Uses pnpm audit --json when available; falls back to npm audit.
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function runAudit(cwd) {
  const pnpm = spawnSync(
    "pnpm",
    ["audit", "--json", "--audit-level", "high"],
    { cwd, encoding: "utf8", shell: true, maxBuffer: 20 * 1024 * 1024 }
  );
  if (pnpm.status === 0 || (pnpm.stdout && pnpm.stdout.trim().startsWith("{"))) {
    return { tool: "pnpm", status: pnpm.status ?? 1, stdout: pnpm.stdout || "", stderr: pnpm.stderr || "" };
  }
  const npm = spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
    cwd,
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { tool: "npm", status: npm.status ?? 1, stdout: npm.stdout || "", stderr: npm.stderr || "" };
}

function summarize(label, result) {
  let critical = 0;
  let high = 0;
  let meta = null;
  try {
    meta = JSON.parse(result.stdout || "{}");
  } catch {
    return {
      label,
      tool: result.tool,
      ok: result.status === 0,
      parse_error: true,
      critical: null,
      high: null,
    };
  }

  if (meta?.metadata?.vulnerabilities) {
    critical = Number(meta.metadata.vulnerabilities.critical ?? 0);
    high = Number(meta.metadata.vulnerabilities.high ?? 0);
  } else if (meta?.advisories) {
    for (const adv of Object.values(meta.advisories)) {
      const sev = String(adv.severity ?? "").toLowerCase();
      if (sev === "critical") critical += 1;
      if (sev === "high") high += 1;
    }
  }

  return {
    label,
    tool: result.tool,
    ok: critical === 0 && high === 0,
    critical,
    high,
  };
}

const targets = [
  { label: "root", cwd: root },
  { label: "web", cwd: join(root, "apps/web") },
  { label: "mobile", cwd: join(root, "apps/mobile") },
];

const reports = targets.map((t) => summarize(t.label, runAudit(t.cwd)));
const failed = reports.filter((r) => r.ok === false);

console.log(JSON.stringify({ ok: failed.length === 0, reports }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
