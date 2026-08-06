#!/usr/bin/env node
/**
 * Audit a marketing CMS page against the current schema + local assets.
 *
 * Schema note: site_menu_items uses menu_id (FK → site_menus.id).
 * There is no column named "menu" — never select it.
 *
 * Usage:
 *   node scripts/audit-site-marketing-page.mjs restaurants
 *   node scripts/audit-site-marketing-page.mjs business --route=/p/business
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const slug = String(process.argv[2] || "").trim().toLowerCase();
if (!slug) {
  console.error("Usage: node scripts/audit-site-marketing-page.mjs <slug> [--route=/p/<slug>]");
  process.exit(2);
}

const routeArg = process.argv.find((a) => a.startsWith("--route="));
const route = routeArg
  ? routeArg.slice("--route=".length)
  : slug === "drivers"
    ? "/drivers"
    : `/p/${slug}`;

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = join(ROOT, "artifacts", "site-audits", `${slug}-${STAMP}`);
mkdirSync(OUT_DIR, { recursive: true });

const PLACEHOLDER_RE =
  /\b(TODO|FIXME|lorem ipsum|placeholder|coming soon|tbd|xxx)\b/i;

const EXPECTED_BLOCK_TYPES = [
  "hero",
  "features",
  "how_it_works",
  "rich_text",
  "cta",
  "faq",
];

function log(msg) {
  console.log(msg);
}

function npxSupabase(args) {
  return spawnSync("npx", ["--yes", "supabase", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    shell: true,
  });
}

function dbQueryJson(sql, label) {
  const sqlPath = join(OUT_DIR, `${label}.sql`);
  writeFileSync(sqlPath, sql, "utf8");
  const r = npxSupabase(["db", "query", "--linked", "-o", "json", "-f", sqlPath]);
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(OUT_DIR, `${label}.out.txt`), out, "utf8");
  if (r.status !== 0) {
    throw new Error(`db query failed (${label}): exit ${r.status}\n${out.slice(-4000)}`);
  }
  // CLI may wrap rows; extract JSON array/object from stdout.
  const trimmed = (r.stdout || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const startObj = trimmed.indexOf("{");
    const i = start >= 0 && (startObj < 0 || start < startObj) ? start : startObj;
    if (i < 0) throw new Error(`could not parse JSON for ${label}\n${trimmed.slice(0, 1000)}`);
    return JSON.parse(trimmed.slice(i));
  }
}

function rowsOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed && parsed.data && Array.isArray(parsed.data)) return parsed.data;
  return [];
}

function publicAssetExists(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return false;
  if (!urlPath.startsWith("/")) return true; // remote URL — skip local check
  const filePath = join(ROOT, "apps", "web", "public", urlPath.replace(/^\//, ""));
  return existsSync(filePath);
}

function collectStrings(value, acc = []) {
  if (typeof value === "string") {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}

const errors = [];
const warnings = [];
const info = [];

try {
  // 1) Schema sanity — refuse obsolete "menu" column assumptions
  const cols = rowsOf(
    dbQueryJson(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'site_menu_items'
       order by ordinal_position;`,
      "menu-columns",
    ),
  ).map((r) => r.column_name);

  if (!cols.includes("menu_id")) {
    errors.push("site_menu_items.menu_id missing from schema");
  }
  if (cols.includes("menu")) {
    errors.push('obsolete column site_menu_items.menu unexpectedly present');
  }
  info.push(`site_menu_items columns: ${cols.join(", ")}`);

  // 2) Menu links for this page (join via menu_id — never select a "menu" column)
  const menuRows = rowsOf(
    dbQueryJson(
      `select m.key as menu_key, i.label, i.href, i.sort_order, i.visible
       from public.site_menu_items i
       join public.site_menus m on m.id = i.menu_id
       where m.locale = 'en'
         and (
           i.href ilike '%${slug.replace(/'/g, "''")}%'
           or i.label ilike '%${slug.replace(/'/g, "''")}%'
           or i.href = '${route.replace(/'/g, "''")}'
         )
       order by m.key, i.sort_order;`,
      "menu-links",
    ),
  );
  info.push(`menu links matched: ${menuRows.length}`);
  if (menuRows.length === 0) {
    warnings.push(`No header/footer menu item found for slug/route ${slug} (${route})`);
  } else {
    const badHref = menuRows.filter(
      (r) =>
        typeof r.href === "string" &&
        (PLACEHOLDER_RE.test(r.href) || r.href.includes("#") || r.href === "/coming-soon"),
    );
    for (const r of badHref) {
      errors.push(`Menu placeholder/bad href: ${r.menu_key} "${r.label}" -> ${r.href}`);
    }
  }

  // 3) Page + blocks
  const pages = rowsOf(
    dbQueryJson(
      `select id, slug, title, status, seo::text as seo
       from public.site_pages
       where locale = 'en' and slug = '${slug.replace(/'/g, "''")}'
       limit 1;`,
      "page",
    ),
  );
  if (pages.length === 0) {
    errors.push(`site_pages row missing for slug=${slug}`);
  } else {
    const page = pages[0];
    info.push(`page title=${page.title} status=${page.status}`);
    if (String(page.status) !== "published") {
      errors.push(`page status is ${page.status}, expected published`);
    }
    if (PLACEHOLDER_RE.test(String(page.title || ""))) {
      errors.push(`page title looks like placeholder: ${page.title}`);
    }
    if (PLACEHOLDER_RE.test(String(page.seo || ""))) {
      errors.push("page SEO payload contains placeholder wording");
    }

    const blocks = rowsOf(
      dbQueryJson(
        `select block_type, sort_order, visible, status, payload::text as payload
         from public.site_page_blocks
         where page_id = '${page.id}'
         order by sort_order;`,
        "blocks",
      ),
    );
    info.push(`blocks: ${blocks.map((b) => b.block_type).join(" → ") || "(none)"}`);

    const types = blocks.map((b) => b.block_type);
    for (const t of EXPECTED_BLOCK_TYPES) {
      if (!types.includes(t)) errors.push(`missing CMS block_type: ${t}`);
    }

    for (const b of blocks) {
      if (b.visible === false) warnings.push(`block ${b.block_type}@${b.sort_order} is not visible`);
      if (String(b.status) !== "published") {
        errors.push(`block ${b.block_type}@${b.sort_order} status=${b.status}`);
      }
      let payload = {};
      try {
        payload = JSON.parse(b.payload || "{}");
      } catch {
        errors.push(`block ${b.block_type}@${b.sort_order} payload is not JSON`);
        continue;
      }
      const strings = collectStrings(payload);
      for (const s of strings) {
        if (PLACEHOLDER_RE.test(s)) {
          errors.push(`placeholder text in ${b.block_type}@${b.sort_order}: ${s.slice(0, 80)}`);
        }
      }
      if (b.block_type === "hero") {
        if (payload.headline_style !== "solid") {
          warnings.push("hero.headline_style is not 'solid' (Drivers/Restaurants parity uses solid orange)");
        }
        const imageUrl = payload.image_url;
        if (!imageUrl) {
          errors.push("hero.image_url missing");
        } else if (!publicAssetExists(String(imageUrl))) {
          errors.push(`hero image asset missing locally: ${imageUrl}`);
        } else {
          info.push(`hero image ok: ${imageUrl}`);
        }
      }
    }
  }

  // 4) Local route + content module checks
  const routeCandidates = [
    join(ROOT, "apps", "web", "app", route.replace(/^\//, ""), "page.tsx"),
    join(ROOT, "apps", "web", "app", slug, "page.tsx"),
    join(ROOT, "apps", "web", "app", "p", slug, "page.tsx"),
  ];
  const routeFile = routeCandidates.find((p) => existsSync(p));
  if (!routeFile) {
    errors.push(`No page.tsx found for route ${route} / slug ${slug}`);
  } else {
    info.push(`route file: ${routeFile.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
    const src = readFileSync(routeFile, "utf8");
    if (PLACEHOLDER_RE.test(src)) {
      errors.push("placeholder wording found in page.tsx source");
    }
    if (!src.includes("HowToJsonLd") && EXPECTED_BLOCK_TYPES.includes("how_it_works")) {
      warnings.push("page.tsx does not reference HowToJsonLd");
    }
  }

  const contentCandidates = [
    join(ROOT, "apps", "web", "src", "components", "site", `${slug}Content.ts`),
    join(ROOT, "apps", "web", "src", "components", "site", `${slug}Content.tsx`),
  ];
  const contentFile = contentCandidates.find((p) => existsSync(p));
  if (!contentFile) {
    warnings.push(`No ${slug}Content.ts module (fallback content) found`);
  } else {
    const src = readFileSync(contentFile, "utf8");
    if (PLACEHOLDER_RE.test(src)) {
      errors.push(`placeholder wording found in ${contentFile}`);
    }
    info.push(`content module: ${contentFile.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
  }

  // 5) Signup path for partner-style pages
  const signupMap = {
    restaurants: "restaurant",
    drivers: "driver",
    business: "business",
  };
  const signupDir = signupMap[slug];
  if (signupDir) {
    const signupPath = join(ROOT, "apps", "web", "app", "signup", signupDir);
    if (!existsSync(signupPath)) {
      errors.push(`signup path missing: apps/web/app/signup/${signupDir}`);
    } else {
      info.push(`signup path ok: /signup/${signupDir}`);
    }
  }

  const report = {
    ok: errors.length === 0,
    slug,
    route,
    errors,
    warnings,
    info,
    menuRows,
    outDir: OUT_DIR,
  };
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");

  log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exit(1);
  process.exit(0);
} catch (e) {
  console.error(String(e?.stack || e));
  process.exit(1);
}
