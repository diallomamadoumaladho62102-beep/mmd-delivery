/**
 * Inventory + i18n gate for every web page.tsx and shared webT / adminT catalogs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEB_LOCALES, WEB_MESSAGES, webT, type WebLocale } from "../i18n/locales";
import { ADMIN_UI_CATALOG } from "../i18n/adminUiCatalog.generated";
import { adminT } from "../i18n/adminUiI18n";
import { listAdminNavEnglishLabels, adminNavLabel } from "../i18n/adminNavI18n";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = path.join(root, "app");

function walkPages(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkPages(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

const pages = walkPages(appDir).map((f) =>
  path
    .relative(appDir, f)
    .replace(/\\/g, "/")
    .replace(/\/page\.tsx$/, "")
    .replace(/^page\.tsx$/, ""),
);
const routes = pages.map((p) => `/${p}`.replace(/\/$/, "") || "/");

assert.ok(routes.length >= 180, `expected ≥180 web page routes, got ${routes.length}`);
assert.ok(routes.includes("/"));
assert.ok(routes.includes("/admin"));
assert.ok(routes.includes("/admin/payouts/sunday"));
assert.ok(routes.includes("/marketplace"));
assert.ok(routes.includes("/taxi"));
assert.ok(routes.includes("/client"));
assert.ok(routes.includes("/login"));
assert.ok(routes.includes("/faq"));

const categories = {
  admin: routes.filter((r) => r === "/admin" || r.startsWith("/admin/")),
  auth: routes.filter((r) => r.startsWith("/auth") || r === "/login" || r.startsWith("/signup")),
  client: routes.filter((r) => r.startsWith("/client") || r.startsWith("/account") || r.startsWith("/orders")),
  driver: routes.filter((r) => r.startsWith("/driver") || r.startsWith("/drivers")),
  restaurant: routes.filter((r) => r.startsWith("/restaurant") || r.startsWith("/restaurants")),
  marketplace: routes.filter((r) => r.startsWith("/marketplace") || r.startsWith("/seller") || r.startsWith("/vendors") || r.startsWith("/items")),
  taxi: routes.filter((r) => r.startsWith("/taxi")),
  legal: routes.filter((r) => r.startsWith("/legal") || r === "/cookies"),
  marketing: routes.filter((r) =>
    [
      "/",
      "/company",
      "/how-it-works",
      "/business",
      "/p/business",
      "/p/restaurants",
      "/faq",
      "/contact",
      "/careers",
      "/partners",
      "/press",
      "/blog",
      "/download",
      "/pricing",
      "/food-delivery",
      "/package-delivery",
      "/services",
    ].includes(r) || r.startsWith("/p/") || r.startsWith("/blog/"),
  ),
};

assert.ok(categories.admin.length >= 70, `admin routes ${categories.admin.length}`);
assert.ok(categories.marketing.length >= 10, `marketing routes ${categories.marketing.length}`);

const enKeys = Object.keys(WEB_MESSAGES.en);
assert.ok(enKeys.length > 20, "webT catalog too small");

for (const locale of WEB_LOCALES) {
  for (const key of enKeys) {
    const value = webT(key, locale);
    assert.ok(String(value).trim().length > 0, `webT ${locale} ${key} empty`);
  }
}

const NON_EN: Exclude<WebLocale, "en">[] = ["fr", "es", "ar", "zh", "ff"];
const ALLOW =
  /^(MMD Delivery|MMD\+|Client|Email|SMS|OK|GPS|Stripe|Marketplace|Restaurants|Code|Support|Actions|Distance|Parking|Promotion|Coupon|Total|Restaurant|Subtotal)$/;
for (const locale of NON_EN) {
  const leftovers = enKeys.filter((key) => {
    const en = WEB_MESSAGES.en[key];
    const loc = WEB_MESSAGES[locale][key];
    if (!en || !loc) return true;
    if (en === loc && en.length > 3 && !ALLOW.test(en) && /[A-Za-z]{4,}/.test(en)) {
      return true;
    }
    return false;
  });
  assert.equal(
    leftovers.length,
    0,
    `${locale} webT leftover English: ${leftovers.slice(0, 20).join(", ")}`,
  );
}

const catalogKeys = Object.keys(ADMIN_UI_CATALOG);
assert.ok(catalogKeys.length > 50, "admin catalog too small");
for (const key of catalogKeys.slice(0, 200)) {
  assert.equal(adminT(key, "en").length > 0, true, `adminT en ${key}`);
  for (const locale of NON_EN) {
    assert.ok(adminT(key, locale).length > 0, `adminT ${locale} ${key}`);
  }
}

for (const label of listAdminNavEnglishLabels()) {
  for (const locale of WEB_LOCALES) {
    assert.ok(adminNavLabel(label, locale).length > 0, `nav ${label}/${locale}`);
  }
}

console.log(
  JSON.stringify({
    ok: true,
    webRoutes: routes.length,
    admin: categories.admin.length,
    webTKeys: enKeys.length,
    adminCatalog: catalogKeys.length,
  }),
);
