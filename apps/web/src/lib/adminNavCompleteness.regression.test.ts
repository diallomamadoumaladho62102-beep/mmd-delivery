/**
 * Ensures Control Center sidebar hrefs resolve to real admin pages
 * and that critical modules (Taxi Pricing) are not hub-only orphans.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAV_GROUPS } from "./adminNav";
import { ADMIN_HUB_LINKS } from "./adminHubLinks";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function collectAdminPages(dir: string, base = "/admin"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      const segment = name.startsWith("[") ? name : name;
      out.push(...collectAdminPages(full, `${base}/${segment}`));
      continue;
    }
    if (name === "page.tsx") {
      out.push(base === "/admin" ? "/admin" : base);
    }
  }
  return out;
}

const adminAppRoot = join(process.cwd(), "app", "admin");
const pages = new Set(collectAdminPages(adminAppRoot));

const DYNAMIC_OK = new Set([
  "/admin/orders/[orderId]",
  "/admin/orders/[orderId]/chat",
  "/admin/payouts/[orderId]",
  "/admin/staff/[id]",
  "/admin/taxi-rides/[rideId]",
  "/admin/site/pages/[id]",
  "/admin/site/posts/[id]",
]);

test("every ADMIN_NAV_GROUPS href has a page.tsx", () => {
  const missing: string[] = [];
  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      if (!pages.has(item.href)) missing.push(item.href);
    }
  }
  assert.deepEqual(missing, [], `nav hrefs without pages: ${missing.join(", ")}`);
});

test("Taxi Pricing page exists and is in both hub + sidebar", () => {
  assert.equal(pages.has("/admin/taxi-pricing"), true);
  const inNav = ADMIN_NAV_GROUPS.some((g) =>
    g.items.some((i) => i.href === "/admin/taxi-pricing"),
  );
  const inHub = ADMIN_HUB_LINKS.some((l) => l.href === "/admin/taxi-pricing");
  assert.equal(inNav, true, "Taxi Pricing must be in sidebar");
  assert.equal(inHub, true, "Taxi Pricing must stay on hub");
});

test("no duplicate sidebar hrefs", () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      const prev = seen.get(item.href);
      if (prev) dupes.push(`${item.href} (${prev} + ${group.id})`);
      else seen.set(item.href, group.id);
    }
  }
  assert.deepEqual(dupes, [], `duplicate nav hrefs: ${dupes.join(", ")}`);
});

test("dynamic admin detail routes remain available", () => {
  for (const href of DYNAMIC_OK) {
    assert.equal(pages.has(href), true, `missing ${href}`);
  }
});

console.log("adminNavCompleteness regression passed");
