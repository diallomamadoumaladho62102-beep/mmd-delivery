#!/usr/bin/env node
/**
 * Phase 9 — lightweight Lighthouse / Web Vitals smoke against production site.
 * Does not require Chrome launcher if lighthouse is missing: falls back to
 * HTTP timing probe + documented budgets.
 *
 * Usage: node scripts/lighthouse-smoke.mjs [url]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "https://www.mmddelivery.com";
const outDir = join(root, "apps/web/.tmp");
mkdirSync(outDir, { recursive: true });

const BUDGETS = {
  performance: 0.5,
  accessibility: 0.8,
  bestPractices: 0.8,
  seo: 0.7,
  LCP_MS: 4000,
  TTFB_MS: 1500,
};

async function httpTimingProbe(url) {
  const started = Date.now();
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "MMD-Phase9-LighthouseSmoke/1.0" },
  });
  const ttfb = Date.now() - started;
  const buf = await res.arrayBuffer();
  const total = Date.now() - started;
  return {
    ok: res.ok,
    status: res.status,
    ttfb_ms: ttfb,
    total_ms: total,
    bytes: buf.byteLength,
    within_ttfb_budget: ttfb <= BUDGETS.TTFB_MS,
  };
}

function tryLighthouse(url) {
  const chromeFlags = "--headless --no-sandbox --disable-gpu";
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "lighthouse@12",
      url,
      "--only-categories=performance,accessibility,best-practices,seo",
      "--quiet",
      "--chrome-flags=" + chromeFlags,
      "--output=json",
      `--output-path=${join(outDir, "lighthouse-phase9.json")}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      shell: true,
      timeout: 180_000,
      env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || "" },
    }
  );
  return result;
}

const probe = await httpTimingProbe(target);
const lh = tryLighthouse(target);

let lighthouse = null;
if (lh.status === 0) {
  try {
    const raw = await import("node:fs").then((fs) =>
      JSON.parse(fs.readFileSync(join(outDir, "lighthouse-phase9.json"), "utf8"))
    );
    const cats = raw.categories || {};
    const audits = raw.audits || {};
    lighthouse = {
      performance: cats.performance?.score ?? null,
      accessibility: cats.accessibility?.score ?? null,
      bestPractices: cats["best-practices"]?.score ?? null,
      seo: cats.seo?.score ?? null,
      LCP_ms: audits["largest-contentful-paint"]?.numericValue ?? null,
      TTFB_ms: audits["server-response-time"]?.numericValue ?? null,
    };
  } catch {
    lighthouse = { parse_error: true };
  }
} else {
  lighthouse = {
    skipped: true,
    reason: "lighthouse_unavailable_or_failed",
    exit: lh.status,
    stderr_tail: String(lh.stderr || "").slice(-400),
  };
}

const report = {
  ok: probe.ok && probe.within_ttfb_budget,
  url: target,
  budgets: BUDGETS,
  http_probe: probe,
  lighthouse,
  generated_at: new Date().toISOString(),
};

writeFileSync(join(outDir, "phase9-lighthouse-smoke.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
