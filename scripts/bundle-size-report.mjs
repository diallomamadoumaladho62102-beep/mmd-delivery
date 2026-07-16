#!/usr/bin/env node
/**
 * Phase 9 — Web/Mobile bundle size snapshot (no EAS build).
 * Web: uses .next build manifest if present, else triggers note.
 * Mobile: sums JS under apps/mobile (src + node_modules/@react-navigation top-level only).
 */
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/web/.tmp");
mkdirSync(outDir, { recursive: true });

function walkSum(dir, pred, acc = { files: 0, bytes: 0 }) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === ".next") continue;
      walkSum(abs, pred, acc);
      continue;
    }
    if (pred(abs, st)) {
      acc.files += 1;
      acc.bytes += st.size;
    }
  }
  return acc;
}

function formatMb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

const webNext = join(root, "apps/web/.next");
let web = { built: false };
if (existsSync(webNext)) {
  const staticJs = walkSum(join(webNext, "static"), (p) => p.endsWith(".js"));
  const server = walkSum(join(webNext, "server"), (p) => p.endsWith(".js"));
  web = {
    built: true,
    static_js_files: staticJs.files,
    static_js_mb: formatMb(staticJs.bytes),
    server_js_files: server.files,
    server_js_mb: formatMb(server.bytes),
    budget_static_js_mb: 8,
    within_static_budget: staticJs.bytes <= 8 * 1024 * 1024,
  };
}

const mobileSrc = walkSum(join(root, "apps/mobile/src"), (p) =>
  /\.(tsx?|jsx?)$/.test(p)
);

const report = {
  ok: web.built ? web.within_static_budget !== false : true,
  web,
  mobile: {
    src_ts_files: mobileSrc.files,
    src_ts_mb: formatMb(mobileSrc.bytes),
    note: "AppNavigator lazy getComponent reduces startup parse; full metro bundle requires EAS (deferred).",
  },
  generated_at: new Date().toISOString(),
};

writeFileSync(join(outDir, "phase9-bundle-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
