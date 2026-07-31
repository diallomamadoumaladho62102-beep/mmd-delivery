#!/usr/bin/env node
/**
 * Lighthouse Desktop + Mobile smoke against production site.
 * Usage: node scripts/lighthouse-smoke.mjs [url]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "https://www.mmddelivery.com";
const outDir = join(root, "apps/web/.tmp");
mkdirSync(outDir, { recursive: true });

const BUDGETS = {
  performance: 0.85,
  accessibility: 0.9,
  bestPractices: 0.9,
  seo: 0.9,
  LCP_MS: 3000,
  TTFB_MS: 1500,
};

async function httpTimingProbe(url) {
  const started = Date.now();
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "MMD-LighthouseSmoke/2.0" },
  });
  const ttfb = Date.now() - started;
  const buf = await res.arrayBuffer();
  return {
    ok: res.ok,
    status: res.status,
    ttfb_ms: ttfb,
    total_ms: Date.now() - started,
    bytes: buf.byteLength,
    within_ttfb_budget: ttfb <= BUDGETS.TTFB_MS,
  };
}

function runLighthouse(url, formFactor) {
  const outPath = join(outDir, `lighthouse-${formFactor}.json`);
  const args = [
    "--yes",
    "lighthouse@12",
    url,
    "--only-categories=performance,accessibility,best-practices,seo",
    "--quiet",
    "--chrome-flags=--headless --no-sandbox --disable-gpu",
    "--output=json",
    `--output-path=${outPath}`,
  ];
  if (formFactor === "desktop") {
    args.push("--preset=desktop");
  } else {
    args.push("--form-factor=mobile", "--screenEmulation.mobile=true");
  }
  const result = spawnSync("npx", args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    timeout: 240_000,
  });
  return { result, outPath };
}

function parseLh(outPath) {
  if (!existsSync(outPath)) return { skipped: true, reason: "missing_report" };
  try {
    const raw = JSON.parse(readFileSync(outPath, "utf8"));
    const cats = raw.categories || {};
    const audits = raw.audits || {};
    const scores = {
      performance: cats.performance?.score ?? null,
      accessibility: cats.accessibility?.score ?? null,
      bestPractices: cats["best-practices"]?.score ?? null,
      seo: cats.seo?.score ?? null,
      LCP_ms: audits["largest-contentful-paint"]?.numericValue ?? null,
      TTFB_ms: audits["server-response-time"]?.numericValue ?? null,
    };
    const within =
      scores.performance != null &&
      scores.performance >= BUDGETS.performance &&
      scores.accessibility != null &&
      scores.accessibility >= BUDGETS.accessibility &&
      scores.bestPractices != null &&
      scores.bestPractices >= BUDGETS.bestPractices &&
      scores.seo != null &&
      scores.seo >= BUDGETS.seo &&
      (scores.LCP_ms == null || scores.LCP_ms <= BUDGETS.LCP_MS);
    return { ...scores, within_budget: within };
  } catch (e) {
    return { parse_error: true, message: String(e?.message || e) };
  }
}

const probe = await httpTimingProbe(target);
const desktopRun = runLighthouse(target, "desktop");
const mobileRun = runLighthouse(target, "mobile");

const desktop =
  desktopRun.result.status === 0
    ? parseLh(desktopRun.outPath)
    : {
        skipped: true,
        exit: desktopRun.result.status,
        stderr_tail: String(desktopRun.result.stderr || "").slice(-400),
      };
const mobile =
  mobileRun.result.status === 0
    ? parseLh(mobileRun.outPath)
    : {
        skipped: true,
        exit: mobileRun.result.status,
        stderr_tail: String(mobileRun.result.stderr || "").slice(-400),
      };

const scoresOk =
  desktop.within_budget === true && mobile.within_budget === true;
const lhRan = !desktop.skipped && !mobile.skipped;
const report = {
  ok: Boolean(probe.ok && (lhRan ? scoresOk : probe.within_ttfb_budget)),
  url: target,
  budgets: BUDGETS,
  http_probe: probe,
  desktop,
  mobile,
  generated_at: new Date().toISOString(),
};

writeFileSync(
  join(outDir, "phase9-lighthouse-smoke.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
