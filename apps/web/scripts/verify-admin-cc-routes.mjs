/**
 * Compare filesystem admin routes vs Control Center nav coverage.
 * Fails if an existing admin page has no nav entry and is not allowlisted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminAppRoot = path.resolve(__dirname, "../app/admin");
const navFile = path.resolve(__dirname, "../src/lib/adminNav.ts");
const hubFile = path.resolve(__dirname, "../src/lib/adminHubLinks.ts");

function walkPages(dir, base = "/admin") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const segment = entry.name.startsWith("[") ? entry.name : entry.name;
      out.push(...walkPages(full, `${base}/${segment}`));
    } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
      out.push(base === "/admin" ? "/admin" : base);
    }
  }
  return out;
}

function extractHrefs(source) {
  const hrefs = new Set();
  const re = /href:\s*"(\/admin[^"]*)"/g;
  let m;
  while ((m = re.exec(source))) hrefs.add(m[1]);
  return hrefs;
}

const pages = walkPages(adminAppRoot).sort();
const nav = extractHrefs(fs.readFileSync(navFile, "utf8"));
const hub = extractHrefs(fs.readFileSync(hubFile, "utf8"));
const covered = new Set([...nav, ...hub]);

/** Dynamic / utility / login routes that do not need a top-level nav item. */
const ALLOW_WITHOUT_NAV = new Set([
  "/admin/login",
  "/admin/admins", // redirect → /admin/staff
  "/admin/staff/[id]",
  "/admin/orders/[orderId]",
  "/admin/orders/[orderId]/chat",
  "/admin/payouts/[orderId]",
  "/admin/clients", // in nav as Customers
  "/admin/hr",
  "/admin/teams",
  "/admin/tasks",
  "/admin/staff",
  "/admin/supervision",
]);

// Normalize: ensure known new enterprise routes are present on disk.
const requiredNew = [
  "/admin/staff",
  "/admin/staff/[id]",
  "/admin/teams",
  "/admin/tasks",
  "/admin/hr",
];
for (const r of requiredNew) {
  if (!pages.includes(r)) {
    console.error(`FAIL missing new enterprise route page: ${r}`);
    process.exit(1);
  }
}

const missingCoverage = pages.filter((p) => {
  if (ALLOW_WITHOUT_NAV.has(p)) return false;
  if (p.includes("[")) return false;
  if (covered.has(p)) return false;
  // Covered if a nav prefix matches (e.g. /admin/mmd-ai covers /admin/mmd-ai/launch via nav)
  for (const href of covered) {
    if (p === href || p.startsWith(href + "/")) return false;
  }
  return true;
});

console.log(
  JSON.stringify(
    {
      ok: missingCoverage.length === 0,
      page_count: pages.length,
      nav_count: nav.size,
      hub_count: hub.size,
      missing_nav_coverage: missingCoverage,
      new_enterprise_routes: requiredNew,
      pages,
    },
    null,
    2
  )
);

if (missingCoverage.length) {
  console.error("FAIL admin routes missing from nav/hub coverage");
  process.exit(1);
}
console.log("ok admin Control Center route coverage");
