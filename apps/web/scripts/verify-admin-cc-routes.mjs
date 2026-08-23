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
  "/admin/payouts/audit",
  "/admin/payouts/reconciliation",
  "/admin/taxi-rides/[rideId]",
  "/admin/driver-identity/settings",
  "/admin/site/contact",
  "/admin/site/faq",
  "/admin/site/media",
  "/admin/site/menus",
  "/admin/site/newsletter",
  "/admin/site/overlays",
  "/admin/site/pages",
  "/admin/site/pages/[id]",
  "/admin/site/posts",
  "/admin/site/posts/[id]",
  "/admin/site/settings",
]);

const requiredNew = [
  "/admin/staff",
  "/admin/staff/[id]",
  "/admin/teams",
  "/admin/tasks",
  "/admin/hr",
  "/admin/taxi-pricing",
];
for (const r of requiredNew) {
  if (!pages.includes(r)) {
    console.error(`FAIL missing required admin route page: ${r}`);
    process.exit(1);
  }
}

if (!nav.has("/admin/taxi-pricing")) {
  console.error("FAIL Taxi Pricing missing from sidebar nav");
  process.exit(1);
}

const missingCoverage = pages.filter((p) => {
  if (ALLOW_WITHOUT_NAV.has(p)) return false;
  if (p.includes("[")) return false;
  if (covered.has(p)) return false;
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
      required_routes: requiredNew,
      taxi_pricing_in_nav: nav.has("/admin/taxi-pricing"),
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
