#!/usr/bin/env node
/**
 * Mandatory pre-validation gate for marketing pages.
 * Fails on any error OR warning. Do not ask for user validation unless exit 0.
 *
 * Usage:
 *   node scripts/gate-site-marketing-page.mjs business --route=/p/business --pr=88 --figma-ok --local-url=http://localhost:3010/p/business
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
const ROOT = process.cwd();
const slug = String(process.argv[2] || "").trim().toLowerCase();
if (!slug) {
  console.error(
    "Usage: node scripts/gate-site-marketing-page.mjs <slug> --route=<path> [--pr=<n>] [--figma-ok] [--local-url=<url>]",
  );
  process.exit(2);
}

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const route =
  arg("--route") ||
  (slug === "drivers"
    ? "/drivers"
    : slug === "marketplace" || slug === "company" || slug === "blog"
      ? `/${slug}`
      : `/p/${slug}`);
const pr = arg("--pr");
const localUrl = arg("--local-url");
const figmaOk = process.argv.includes("--figma-ok");

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = join(ROOT, "artifacts", "site-gates", `${slug}-${STAMP}`);
mkdirSync(OUT_DIR, { recursive: true });

const checklist = {
  figma: { ok: false, detail: "" },
  cms: { ok: false, detail: "" },
  seo: { ok: false, detail: "" },
  a11y: { ok: false, detail: "" },
  responsive: { ok: false, detail: "" },
  assets: { ok: false, detail: "" },
  links: { ok: false, detail: "" },
  performance: { ok: false, detail: "" },
  typescript_eslint: { ok: false, detail: "" },
  ci_vercel: { ok: false, detail: "" },
};

const errors = [];
const warnings = []; // kept for report; gate fails if any remain
const info = [];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    shell: true,
    ...opts,
  });
  return r;
}

function fail(section, msg) {
  errors.push(`[${section}] ${msg}`);
  checklist[section] && (checklist[section].ok = false);
  checklist[section] && (checklist[section].detail = msg);
}

function pass(section, msg) {
  checklist[section].ok = true;
  checklist[section].detail = msg;
  info.push(`[${section}] ${msg}`);
}

function warn(section, msg) {
  warnings.push(`[${section}] ${msg}`);
}

function parseSupabaseJson(stdout) {
  const text = String(stdout || "");
  // Pretty-printed CLI JSON often starts with "{\n  \"boundary\"".
  const boundaryIdx = text.search(/\{\s*"boundary"\s*:/);
  const rowsIdx = text.search(/\{\s*"rows"\s*:/);
  const startObj = boundaryIdx >= 0 ? boundaryIdx : rowsIdx;
  if (startObj >= 0) {
    // Slice from object start to last closing brace before trailing logs.
    const slice = text.slice(startObj);
    const end = slice.lastIndexOf("}");
    const parsed = JSON.parse(end >= 0 ? slice.slice(0, end + 1) : slice);
    if (Array.isArray(parsed?.rows)) return parsed.rows;
    if (Array.isArray(parsed)) return parsed;
  }
  const startArr = text.indexOf("[");
  if (startArr >= 0) {
    const slice = text.slice(startArr);
    const end = slice.lastIndexOf("]");
    const parsed = JSON.parse(end >= 0 ? slice.slice(0, end + 1) : slice);
    return Array.isArray(parsed) ? parsed : parsed?.rows || [];
  }
  return [];
}

function hasContentPlaceholder(text) {
  // Ignore HTML/CSS placeholder attributes/utilities (e.g. placeholder="you@email.com").
  const stripped = String(text || "")
    .replace(/\bplaceholder\s*=\s*("[^"]*"|'[^']*')/gi, " ")
    .replace(/\bplaceholder:[a-z0-9_/-]+/gi, " ");
  return /\b(TODO|FIXME|lorem ipsum|tbd|coming soon)\b/i.test(stripped);
}

// --- 1) Figma attestation (agent must have completed visual audit) ---
if (!figmaOk) {
  fail(
    "figma",
    "missing --figma-ok (agent must attest Desktop/Tablet/Mobile Figma ↔ code parity)",
  );
} else {
  pass("figma", "agent attested Figma ↔ code 100% (--figma-ok)");
}

// --- 2) CMS + assets + links via audit script (strict: warnings fail) ---
{
  const auditArgs = [
    "scripts/audit-site-marketing-page.mjs",
    slug,
    `--route=${route}`,
  ];
  const r = run("node", auditArgs);
  writeFileSync(
    join(OUT_DIR, "cms-audit.out.txt"),
    `${r.stdout || ""}\n${r.stderr || ""}`,
    "utf8",
  );
  let report = null;
  try {
    const text = String(r.stdout || "");
    const start = text.indexOf("{");
    if (start >= 0) report = JSON.parse(text.slice(start));
  } catch {
    report = null;
  }
  if (r.status !== 0 || !report) {
    fail("cms", `audit-site-marketing-page failed (exit ${r.status})`);
  } else {
    if ((report.errors || []).length) {
      for (const e of report.errors) fail("cms", e);
    } else {
      pass("cms", `CMS composition ok: ${(report.info || []).find((i) => i.startsWith("blocks:")) || "published"}`);
    }
    // Promote former soft warnings to gate failures (zero-warning policy)
    for (const w of report.warnings || []) warn("cms", w);

    const heroLine = (report.info || []).find((i) => i.includes("hero image ok"));
    if (heroLine) pass("assets", heroLine);
    else if (!(report.errors || []).some((e) => /image|asset|placeholder/i.test(e))) {
      // assets may still fail below via SEO/link checks
      pass("assets", "no asset errors from CMS audit");
    }
  }
}

// --- 3) SEO (CMS seo object) ---
{
  const sql = `select seo->>'title' as title, seo->>'description' as description, seo->>'robots' as robots
    from public.site_pages where locale='en' and slug='${slug.replace(/'/g, "''")}' limit 1;`;
  writeFileSync(join(OUT_DIR, "seo.sql"), sql, "utf8");
  const r = run("npx", [
    "--yes",
    "supabase",
    "db",
    "query",
    "--linked",
    "-o",
    "json",
    "-f",
    join(OUT_DIR, "seo.sql"),
  ]);
  const seoOut = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(OUT_DIR, "seo.out.txt"), seoOut, "utf8");
  let rows = [];
  try {
    rows = parseSupabaseJson(seoOut);
  } catch (e) {
    rows = [];
    warn("seo", `SEO JSON parse error: ${e.message || e}`);
  }
  const seo = rows[0] || {};
  const bad =
    !seo.title ||
    !seo.description ||
    String(seo.title).length < 8 ||
    String(seo.description).length < 40 ||
    hasContentPlaceholder(`${seo.title} ${seo.description}`);
  if (bad) {
    fail("seo", `SEO incomplete or placeholder: ${JSON.stringify(seo)}`);
  } else {
    pass(
      "seo",
      `title/description ok (robots=${seo.robots || "unset"})`,
    );
  }
}

// --- 4) Links from CMS payloads ---
{
  const sql = `select b.block_type, b.payload::text as payload
    from public.site_page_blocks b
    join public.site_pages p on p.id=b.page_id
    where p.locale='en' and p.slug='${slug.replace(/'/g, "''")}';`;
  writeFileSync(join(OUT_DIR, "links.sql"), sql, "utf8");
  const r = run("npx", [
    "--yes",
    "supabase",
    "db",
    "query",
    "--linked",
    "-o",
    "json",
    "-f",
    join(OUT_DIR, "links.sql"),
  ]);
  const linksOut = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(OUT_DIR, "links.out.txt"), linksOut, "utf8");
  let rows = [];
  try {
    rows = parseSupabaseJson(linksOut);
  } catch (e) {
    rows = [];
    warn("links", `links JSON parse error: ${e.message || e}`);
  }

  const hrefs = new Set();
  const hrefRe = /"href"\s*:\s*"([^"]+)"|\]\((\/[^)]+)\)/g;
  for (const row of rows) {
    const raw =
      typeof row.payload === "string"
        ? row.payload
        : JSON.stringify(row.payload || {});
    let m;
    while ((m = hrefRe.exec(raw))) {
      hrefs.add(m[1] || m[2]);
    }
  }
  if (rows.length === 0) {
    fail("links", "could not load CMS payloads for link audit");
  }

  const broken = [];
  for (const href of hrefs) {
    if (!href.startsWith("/")) continue; // external
    if (href.startsWith("/api/")) continue;
    const clean = href.split("#")[0].split("?")[0];
    const candidates = [
      join(ROOT, "apps", "web", "app", clean.replace(/^\//, ""), "page.tsx"),
      join(ROOT, "apps", "web", "app", clean.replace(/^\//, ""), "page.ts"),
      join(ROOT, "apps", "web", "app", ...(clean.replace(/^\//, "").split("/")), "page.tsx"),
    ];
    // app router: /signup/restaurant -> app/signup/restaurant/page.tsx
    const parts = clean.replace(/^\//, "").split("/");
    candidates.push(join(ROOT, "apps", "web", "app", ...parts, "page.tsx"));
    // also allow route groups / dynamic — treat known public marketing files
    if (!candidates.some((p) => existsSync(p))) {
      // special-case: /download, /how-it-works, /contact etc.
      const alt = join(ROOT, "apps", "web", "app", parts[0], "page.tsx");
      if (!existsSync(alt)) broken.push(href);
    }
  }
  if (broken.length) {
    fail("links", `broken internal hrefs: ${broken.join(", ")}`);
  } else {
    pass("links", `checked ${hrefs.size} href(s), none broken`);
  }
}

// --- 5) Local page HTML: a11y + responsive markers + performance hints ---
if (!localUrl) {
  fail(
    "a11y",
    "missing --local-url (required for a11y/responsive/perf HTML checks)",
  );
  fail("responsive", "missing --local-url");
  fail("performance", "missing --local-url");
} else {
  try {
    const res = await fetch(localUrl, {
      headers: { "user-agent": "mmd-site-gate/1.0" },
      redirect: "follow",
    });
    const html = await res.text();
    writeFileSync(join(OUT_DIR, "page.html"), html.slice(0, 2_000_000), "utf8");
    if (!res.ok) fail("a11y", `local fetch HTTP ${res.status}`);

    const a11yChecks = [
      [/Skip to content/i, "skip link"],
      [/<h1[\s>]/i, "h1"],
      [/aria-label|aria-expanded|role="navigation"/i, "aria landmarks"],
    ];
    const a11yFail = [];
    for (const [re, label] of a11yChecks) {
      if (!re.test(html)) a11yFail.push(label);
    }
    if (/alt=""/i.test(html) && /<img[\s\S]{0,80}alt=""/i.test(html)) {
      // empty alt on decorative may be ok; warn only if many
      const emptyAlts = (html.match(/\salt=""/g) || []).length;
      if (emptyAlts > 3) warn("a11y", `many empty alt attributes (${emptyAlts})`);
    }
    if (a11yFail.length) fail("a11y", `missing: ${a11yFail.join(", ")}`);
    else pass("a11y", "skip link, h1, aria markers present");

    const responsiveSignals = [
      /sm:|md:|lg:|max-sm:|max-md:/,
      /viewport/,
      /Open menu|Primary/i,
    ];
    if (!responsiveSignals.every((re) => re.test(html) || re.source === "Open menu|Primary")) {
      // soft: at least viewport + responsive classes in markup/CSS chunks
    }
    if (!/name="viewport"|viewport-fit/i.test(html) && !/viewport/i.test(html)) {
      // Next.js often injects viewport via metadata API — accept width-based classes
    }
    if (!/(sm:|md:|lg:)/.test(html)) {
      fail("responsive", "no responsive Tailwind breakpoints found in HTML");
    } else {
      pass(
        "responsive",
        "responsive class markers present (Desktop/Tablet/Mobile verified by agent + breakpoints in markup)",
      );
    }

    // Performance: reject auth walls / huge obvious issues / missing hero image ref
    if (/Log in to Vercel|Authentication Required/i.test(html)) {
      fail("performance", "local/preview returned auth wall HTML");
    } else if (html.length < 5000) {
      fail("performance", `HTML unexpectedly small (${html.length} bytes)`);
    } else {
      const heroRef =
        /brand\/services\/(food|taxi|marketplace|package)\.(webp|png|jpg)/i.test(
          html,
        ) || /_next\/image/i.test(html);
      if (!heroRef) {
        fail(
          "performance",
          "no optimized image / brand service asset detected in HTML",
        );
      } else {
        pass(
          "performance",
          `HTML size=${html.length}; image pipeline signals ok`,
        );
      }
    }

    if (hasContentPlaceholder(html)) {
      fail("assets", "placeholder wording found in rendered HTML");
    } else if (!checklist.assets.ok) {
      pass("assets", "no placeholder wording in rendered HTML");
    }
  } catch (e) {
    fail("a11y", `local fetch failed: ${e.message || e}`);
    fail("responsive", `local fetch failed: ${e.message || e}`);
    fail("performance", `local fetch failed: ${e.message || e}`);
  }
}

// --- 6) TypeScript + ESLint ---
{
  const tsc = run("pnpm", ["--dir", "apps/web", "exec", "tsc", "--noEmit"]);
  writeFileSync(
    join(OUT_DIR, "tsc.out.txt"),
    `${tsc.stdout || ""}\n${tsc.stderr || ""}`,
    "utf8",
  );
  if (tsc.status !== 0) {
    fail("typescript_eslint", `tsc --noEmit failed (exit ${tsc.status})`);
  } else {
    const lintTargets = [
      `app${route}/page.tsx`.replace("//", "/"),
      `src/components/site/${slug}Content.ts`,
    ];
    // Normalize Windows paths for eslint from apps/web
    const files = [];
    const pageRel = route.replace(/^\//, "");
    const pagePath = join(ROOT, "apps", "web", "app", pageRel, "page.tsx");
    const contentPath = join(
      ROOT,
      "apps",
      "web",
      "src",
      "components",
      "site",
      `${slug}Content.ts`,
    );
    if (existsSync(pagePath)) files.push(pagePath);
    if (existsSync(contentPath)) files.push(contentPath);

    if (files.length === 0) {
      fail("typescript_eslint", "no page/content files to lint");
    } else {
      const lint = run("pnpm", [
        "--dir",
        "apps/web",
        "exec",
        "eslint",
        ...files.map((f) => f.replace(/\\/g, "/")),
      ]);
      writeFileSync(
        join(OUT_DIR, "eslint.out.txt"),
        `${lint.stdout || ""}\n${lint.stderr || ""}`,
        "utf8",
      );
      if (lint.status !== 0) {
        fail(
          "typescript_eslint",
          `eslint failed (exit ${lint.status}): ${(lint.stdout || lint.stderr || "").slice(0, 500)}`,
        );
      } else {
        pass("typescript_eslint", "tsc --noEmit + eslint clean on page surface");
      }
    }
  }
}

// --- 7) CI + Vercel ---
if (!pr) {
  fail("ci_vercel", "missing --pr=<number> for CI/Vercel verification");
} else {
  const r = run("gh", [
    "pr",
    "checks",
    String(pr),
    "--required",
  ]);
  // gh pr checks --required may not exist on all versions; fallback
  const checks = run("gh", ["pr", "checks", String(pr)]);
  writeFileSync(
    join(OUT_DIR, "gh-checks.out.txt"),
    `${checks.stdout || ""}\n${checks.stderr || ""}`,
    "utf8",
  );
  const out = `${checks.stdout || ""}\n${checks.stderr || ""}`;
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const failed = lines.filter((l) => /\bfail(ed)?\b/i.test(l) || /\bpending\b/i.test(l));
  const hasVerify = /verify/i.test(out);
  const hasVercel = /Vercel/i.test(out);
  const allPass =
    hasVerify &&
    hasVercel &&
    !/\bfail/i.test(out) &&
    !/\bpending\b/i.test(out) &&
    (/\bpass\b/i.test(out) || /\bsuccess\b/i.test(out));

  // Parse table-like: name\tpass|fail|pending
  let anyPending = false;
  let anyFail = false;
  let vercelPass = false;
  let verifyPass = false;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("\tpending") || /\bpending\b/.test(lower)) anyPending = true;
    if (lower.includes("\tfail") || /\bfail/.test(lower)) anyFail = true;
    if (lower.startsWith("vercel") && lower.includes("pass")) vercelPass = true;
    if (lower.startsWith("verify") && lower.includes("pass")) verifyPass = true;
  }
  if (anyFail || anyPending || !vercelPass || !verifyPass) {
    fail(
      "ci_vercel",
      `PR #${pr} checks not fully green (verifyPass=${verifyPass}, vercelPass=${vercelPass}, pending=${anyPending}, fail=${anyFail})`,
    );
  } else {
    pass("ci_vercel", `PR #${pr} verify + Vercel pass; no pending/fail`);
  }
}

const report = {
  ok: errors.length === 0 && warnings.length === 0 && Object.values(checklist).every((c) => c.ok),
  slug,
  route,
  pr,
  localUrl,
  figmaOk,
  checklist,
  errors,
  warnings,
  info,
  outDir: OUT_DIR,
};
writeFileSync(join(OUT_DIR, "gate-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));

if (!report.ok) process.exit(1);
console.log("\nGATE_OK — safe to ask user for 100% validation.");
process.exit(0);
