#!/usr/bin/env node
/**
 * OWASP ZAP baseline against a non-production target.
 * Never scans www.mmddelivery.com / mmddelivery.com.
 * Exit 1 on High/Critical alerts.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTION_HOSTS = new Set(["www.mmddelivery.com", "mmddelivery.com"]);

function hostnameOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const target = String(process.env.ZAP_TARGET ?? "http://127.0.0.1:3000").trim();
const host = hostnameOf(target);
if (!target || PRODUCTION_HOSTS.has(host)) {
  console.error("ZAP refused: production hosts are not allowed. Use localhost or Preview.");
  process.exit(2);
}

const workDir = resolve(process.cwd(), "zap-out");
const reportPath = resolve(workDir, "zap-report.json");
const image = process.env.ZAP_IMAGE || "ghcr.io/zaproxy/zaproxy:stable";

mkdirSync(workDir, { recursive: true });
try {
  chmodSync(workDir, 0o777);
} catch {
  /* Windows / non-POSIX */
}

const docker = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--user",
    "zap",
    "--network",
    "host",
    "-v",
    `${workDir}:/zap/wrk:rw`,
    image,
    "zap-baseline.py",
    "-t",
    target,
    "-J",
    "zap-report.json",
    "-I",
  ],
  { encoding: "utf8" }
);

const combined = `${docker.stdout || ""}\n${docker.stderr || ""}`;
process.stdout.write(docker.stdout || "");
process.stderr.write(docker.stderr || "");

const failNew = /FAIL-NEW:\s*(\d+)/.exec(combined);
const failCount = failNew ? Number(failNew[1]) : null;

if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const sites = Array.isArray(report.site) ? report.site : [];
  const alerts = sites.flatMap((site) => site.alerts ?? []);
  const high = alerts.filter((a) => /^(High|Critical)$/i.test(String(a.riskdesc ?? a.risk ?? "")));
  console.log(
    JSON.stringify(
      { target, alert_count: alerts.length, high_critical: high.map((a) => a.name ?? a.alert) },
      null,
      2
    )
  );
  if (high.length > 0) process.exit(1);
} else if (failCount === null) {
  console.error("ZAP produced neither a JSON report nor a FAIL-NEW summary.");
  process.exit(docker.status === 0 ? 1 : docker.status ?? 1);
}

if (failCount && failCount > 0) {
  process.exit(1);
}

process.exit(0);
