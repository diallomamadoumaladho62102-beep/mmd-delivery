#!/usr/bin/env node
/**
 * OWASP ZAP baseline against a non-production target.
 * Never scans www.mmddelivery.com / mmddelivery.com.
 * Exit 1 on High/Critical alerts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const reportPath = resolve(process.cwd(), "zap-report.json");
const image = process.env.ZAP_IMAGE || "ghcr.io/zaproxy/zaproxy:stable";

const docker = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "host",
    "-v",
    `${process.cwd()}:/zap/wrk:rw`,
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

process.stdout.write(docker.stdout || "");
process.stderr.write(docker.stderr || "");

if (!existsSync(reportPath)) {
  console.error("ZAP report missing. Docker may be unavailable or the target was unreachable.");
  process.exit(docker.status === 0 ? 1 : docker.status ?? 1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const sites = Array.isArray(report.site) ? report.site : [];
const alerts = sites.flatMap((site) => site.alerts ?? []);
const high = alerts.filter((a) => /^(High|Critical)$/i.test(String(a.riskdesc ?? a.risk ?? "")));

console.log(
  JSON.stringify(
    {
      target,
      alert_count: alerts.length,
      high_critical: high.map((a) => a.name ?? a.alert),
    },
    null,
    2
  )
);

if (high.length > 0) {
  process.exit(1);
}

process.exit(0);
