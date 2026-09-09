/**
 * Extract unique hardcoded JSX/placeholder strings from web portal surfaces
 * (account, restaurant, signup, orders, client, driver, seller, auth, business).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "app/account",
  "app/restaurant",
  "app/signup",
  "app/orders",
  "app/client",
  "app/driver",
  "app/seller",
  "app/auth",
  "app/business",
  "app/promotions",
  "src/components/SiteShell.tsx",
  "src/components/site",
  "src/components/MmdPlusPortal.tsx",
  "src/components/WebI18nProvider.tsx",
  "src/components/LanguageSwitcher.tsx",
  "src/components/WebLanguageSwitcher.tsx",
  "app/taxi",
  "app/delivery",
  "app/food",
  "app/marketplace",
  "app/restaurants",
  "app/login",
  "app/search",
  "app/blog",
  "app/brand",
  "app/error.tsx",
  "app/not-found.tsx",
].map((p) => path.join(root, p));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    if (/\.tsx$/.test(dir)) out.push(dir);
    return out;
  }
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "api") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\b(?:t|adminT|adminNavLabel|adminShellT|i18n\.t)\(\s*(["'`])(?:\\.|(?!\1).)*\1(?:\s*,[\s\S]*?)?\)/g, "/*i18n*/");
}

const SKIP = new Set([
  "MMD",
  "MMD+",
  "MMD Delivery",
  "OK",
  "SMS",
  "GPS",
  "ID",
  "USD",
  "Stripe",
  "US",
  "GN",
  "ON",
  "OFF",
]);

const files = [];
for (const t of targets) walk(t, files);
const counts = new Map();

for (const file of files) {
  const src = strip(fs.readFileSync(file, "utf8"));
  const re = />\s*([A-ZÀ-ÖØ-Þ][^<{]{2,90}?)\s*</g;
  let m;
  while ((m = re.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!text || SKIP.has(text) || /[{`]/.test(text)) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  const ph = /\bplaceholder\s*=\s*(["'])([^"'{}]{2,80})\1/g;
  while ((m = ph.exec(src))) {
    const text = m[2].trim();
    if (!text || SKIP.has(text)) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
}

const unique = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const out = {
  filesInspected: files.length,
  uniqueCount: unique.length,
  top: unique.slice(0, 80).map(([text, count]) => ({ count, text })),
  all: unique.map(([text, count]) => ({ count, text })),
};
fs.writeFileSync(
  path.join(root, "src", "i18n", "portal-ui-unique-strings.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify({ filesInspected: files.length, uniqueCount: unique.length }, null, 2));
