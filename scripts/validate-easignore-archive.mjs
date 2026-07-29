/**
 * Local proof that .easignore would produce an EAS project archive < 50 MB.
 * Simulates EAS CLI ignore behaviour with the `ignore` package (same patterns).
 *
 * Usage: node scripts/validate-easignore-archive.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let ignoreFactory;
try {
  ignoreFactory = require("ignore");
} catch {
  console.error("Missing dependency: ignore. Run: pnpm add -D ignore");
  process.exit(1);
}

const easignorePath = path.join(root, ".easignore");
if (!fs.existsSync(easignorePath)) {
  console.error(".easignore missing at", easignorePath);
  process.exit(1);
}

const rawRules = fs
  .readFileSync(easignorePath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const ig = ignoreFactory().add(rawRules);

const MUST_INCLUDE = [
  // Canonical Expo config for EAS (repo root — not apps/mobile/)
  "app.config.ts",
  "apps/mobile/app.json",
  "eas.json",
  "pnpm-lock.yaml",
  "package.json",
  "apps/mobile/package.json",
  "apps/mobile/src",
  "apps/mobile/assets",
  "apps/mobile/assets/sounds/mmd_system_notification.wav",
  "apps/mobile/assets/sounds/mmd_signature_driver_60s.wav",
  "android",
  "android/app/build.gradle",
];

const MUST_EXCLUDE = [
  "docs",
  "apps/mobile/preview",
  "apps/mobile/android",
  ".git",
  "apps/web",
  "supabase",
  "node_modules",
];

const MUST_EXCLUDE_GLOBS_SAMPLES = [
  // prove heavy / junk paths that matched prior 355MB uploads
];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = toPosix(path.relative(root, abs));
    if (!rel || rel === ".") continue;

    // Always skip walking into ignored directories for speed
    if (ent.isDirectory()) {
      // gitignore-style: directory match needs trailing slash check
      if (ig.ignores(rel) || ig.ignores(rel + "/")) continue;
      // still walk .git? MUST be excluded — if somehow not ignored, skip hard
      if (rel === ".git" || rel.startsWith(".git/")) continue;
      walk(abs, out);
      continue;
    }
    if (ent.isFile() || ent.isSymbolicLink()) {
      if (ig.ignores(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

function fileSize(rel) {
  try {
    return fs.statSync(path.join(root, rel)).size;
  } catch {
    return 0;
  }
}

function pathExists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function isIncluded(rel) {
  // Directory existence + any kept children, or file kept
  if (!pathExists(rel)) return { exists: false, included: false };
  if (ig.ignores(rel) || ig.ignores(rel.replace(/\/?$/, "/") )) {
    // For dirs: included if ANY non-ignored child under it exists in the kept set
    // handled below with prefixes
  }
  const abs = path.join(root, rel);
  const st = fs.statSync(abs);
  if (st.isFile()) {
    return { exists: true, included: !ig.ignores(rel) };
  }
  // directory: included if we keep any file under it
  return { exists: true, included: null }; // filled after walk
}

const keptFiles = walk(root);
const sizes = keptFiles.map((rel) => ({ rel, size: fileSize(rel) }));
sizes.sort((a, b) => b.size - a.size);

const uncompressedBytes = sizes.reduce((s, x) => s + x.size, 0);

// Sample gzip ratio on largest files (up to 25MB sample) for archive estimate
let sampleRaw = 0;
let sampleGz = 0;
for (const row of sizes.slice(0, 40)) {
  if (sampleRaw > 25 * 1024 * 1024) break;
  const buf = fs.readFileSync(path.join(root, row.rel));
  sampleRaw += buf.length;
  sampleGz += zlib.gzipSync(buf, { level: 6 }).length;
}
const ratio = sampleRaw > 0 ? sampleGz / sampleRaw : 0.45;
const estimatedGzipBytes = Math.round(uncompressedBytes * ratio);

const MB = (n) => (n / (1024 * 1024)).toFixed(2);

const includeResults = MUST_INCLUDE.map((rel) => {
  const exists = pathExists(rel);
  let included = false;
  if (!exists) {
    return { path: rel, exists, included: false };
  }
  const abs = path.join(root, rel);
  const st = fs.statSync(abs);
  if (st.isFile()) {
    included = !ig.ignores(rel);
  } else {
    included = keptFiles.some(
      (f) => f === rel || f.startsWith(rel.replace(/\/?$/, "/") ),
    );
  }
  return { path: rel, exists, included };
});

const excludeResults = MUST_EXCLUDE.map((rel) => {
  const exists = pathExists(rel);
  // Excluded means: path is ignored OR no kept files under it
  const keptUnder = keptFiles.some(
    (f) => f === rel || f.startsWith(rel.replace(/\/?$/, "/") ),
  );
  const ignoredByRule =
    ig.ignores(rel) || ig.ignores(rel.replace(/\/?$/, "/"));
  return {
    path: rel,
    exists_on_disk: exists,
    excluded: !keptUnder,
    ignored_by_easignore: ignoredByRule || !exists,
  };
});

// Extra junk patterns that must not appear in kept set
const junkPatterns = [
  /^apps\/mobile\/preview\//,
  /^apps\/mobile\/android\//,
  /^\.git\//,
  /^docs\//,
  /^apps\/web\//,
  /\.apk$/i,
  /\.aab$/i,
  /\.ipa$/i,
  /node_modules\//,
];
const junkLeaks = keptFiles.filter((f) => junkPatterns.some((re) => re.test(f)));

const allMustIncludeOk = includeResults.every((r) => r.exists && r.included);
const allMustExcludeOk = excludeResults.every((r) => r.excluded);
const sizeOk = estimatedGzipBytes < 50 * 1024 * 1024;
const uncompressedOk = uncompressedBytes < 80 * 1024 * 1024; // soft guard
const noJunk = junkLeaks.length === 0;

const report = {
  ok: allMustIncludeOk && allMustExcludeOk && sizeOk && noJunk,
  thresholds: {
    estimated_gzip_max_mb: 50,
    estimated_gzip_mb: Number(MB(estimatedGzipBytes)),
    uncompressed_mb: Number(MB(uncompressedBytes)),
    gzip_sample_ratio: Number(ratio.toFixed(3)),
    kept_file_count: keptFiles.length,
  },
  must_include: includeResults,
  must_exclude: excludeResults,
  junk_leaks: junkLeaks.slice(0, 30),
  top_largest_kept: sizes.slice(0, 15).map((x) => ({
    path: x.rel,
    mb: Number(MB(x.size)),
  })),
  verdict: {
    size_lt_50mb_estimated_gzip: sizeOk,
    required_files_included: allMustIncludeOk,
    junk_excluded: allMustExcludeOk && noJunk,
  },
};

fs.mkdirSync(path.join(root, "apps/web/.tmp"), { recursive: true });
const outPath = path.join(root, "apps/web/.tmp/easignore-archive-validation.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.log("\nWrote", outPath);
process.exit(report.ok ? 0 : 2);
