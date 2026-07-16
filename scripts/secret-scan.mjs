#!/usr/bin/env node
/**
 * Phase 8 — repository secret scan (no secret values printed).
 * Scans tracked source for high-risk credential patterns.
 * Exit 1 on hit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".tmp",
  "agent-transcripts",
  "terminals",
]);

const SKIP_FILE_GLOBS = [
  /\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /package-lock\.json$/i,
  /\.map$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.webp$/i,
  /\.pdf$/i,
  /\.wav$/i,
  /\.mp4$/i,
  /dependabot.*\.json$/i,
];

const PATTERNS = [
  // Real Stripe live secrets are long; avoid flagging identifiers like sk_live_unavailable.
  { id: "stripe_sk_live", re: /sk_live_[A-Za-z0-9]{24,}/g },
  { id: "stripe_sk_test_hardcoded", re: /sk_test_[A-Za-z0-9]{24,}/g },
  { id: "stripe_whsec", re: /whsec_[A-Za-z0-9]{24,}/g },
  { id: "supabase_service_role_jwt", re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { id: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { id: "private_key_block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "github_pat", re: /ghp_[A-Za-z0-9]{20,}/g },
  {
    id: "cron_secret_assignment",
    re: /CRON_SECRET\s*=\s*['"][A-Za-z0-9_+\/-]{16,}['"]/g,
  },
];

const ALLOWLIST_PATH_SNIPPETS = [
  "scripts/verify-b6-eas-secrets.mjs",
  "scripts/secret-scan.mjs",
  ".env.example",
  "docs/production/SECRET_ROTATION",
  "uploadSecurity.test.ts",
  ".test.ts",
  ".test.mjs",
  ".test.js",
];

function shouldSkipFile(absPath) {
  const rel = relative(root, absPath).replace(/\\/g, "/");
  if (SKIP_FILE_GLOBS.some((re) => re.test(rel))) return true;
  if (ALLOWLIST_PATH_SNIPPETS.some((s) => rel.includes(s))) return true;
  if (rel.endsWith(".env") || rel.includes(".env.") || rel.endsWith(".local")) {
    // Env files may contain secrets locally — skip content but warn presence only via name.
    return true;
  }
  return false;
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(abs)) continue;
    const st = statSync(abs);
    if (st.size > 1_500_000) continue;
    out.push(abs);
  }
  return out;
}

function scanFile(absPath) {
  const rel = relative(root, absPath).replace(/\\/g, "/");
  let text = "";
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const hits = [];
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    if (!pattern.re.test(text)) continue;
    // JWT pattern is noisy — only flag if near service_role / SUPABASE_SERVICE
    if (pattern.id === "supabase_service_role_jwt") {
      const nearby = /service_role|SUPABASE_SERVICE_ROLE|Bearer eyJ/i.test(text);
      if (!nearby) continue;
    }
    if (pattern.id === "stripe_sk_test_hardcoded") {
      // Allow docs mentioning format, not full keys — require long match already.
      if (/sk_test_your|sk_test_<|sk_test_\.\.\./i.test(text)) continue;
    }
    hits.push({ file: rel, pattern: pattern.id });
  }
  return hits;
}

const files = walk(root);
const findings = files.flatMap(scanFile);

if (findings.length > 0) {
  console.error("SECRET_SCAN_FAIL");
  for (const hit of findings.slice(0, 50)) {
    console.error(`- ${hit.pattern} in ${hit.file}`);
  }
  if (findings.length > 50) {
    console.error(`… and ${findings.length - 50} more`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    files_scanned: files.length,
    findings: 0,
  })
);
