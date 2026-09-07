/**
 * Wire adminT / useAdminT into Admin pages + components (conservative).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "src", "i18n", "adminUiCatalog.json"), "utf8")
);
const KEYS = new Set(Object.keys(catalog));

const targets = [
  path.join(root, "app", "admin"),
  path.join(root, "src", "components", "admin"),
];

const PROP_NAMES =
  "title|subtitle|label|placeholder|aria-label|aria-placeholder|alt|emptyTitle|emptyDescription|confirmLabel|cancelLabel|buttonText|heading|description";

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isClient(src) {
  return /^\s*["']use client["']/.test(src);
}

function wrapProps(src, tName) {
  const re = new RegExp(
    `\\b(${PROP_NAMES})(\\s*=\\s*)(?:\\{\\s*)?(["\`])([\\s\\S]*?)\\3(?:\\s*\\})?`,
    "g"
  );
  return src.replace(re, (full, prop, eq, quote, value) => {
    if (full.includes(`${tName}(`) || full.includes("adminT(")) return full;
    if (quote === "`" && value.includes("${")) return full;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!KEYS.has(trimmed)) return full;
    return `${prop}${eq}{${tName}("${esc(trimmed)}")}`;
  });
}

function wrapJsxText(src, tName) {
  return src.replace(/>(\s*)([^<>{}\n][^<>{}]*?)(\s*)</g, (full, a, text, b) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed || !KEYS.has(trimmed)) return full;
    if (text.includes("{")) return full;
    return `>${a}{${tName}("${esc(trimmed)}")}${b}<`;
  });
}

function wrapAlertConfirm(src, tName) {
  return src.replace(
    /\b(alert|confirm|prompt)\(\s*(["'])([^"'\\\n]+)\2/g,
    (full, fn, _q, value) => {
      if (!KEYS.has(value)) return full;
      return `${fn}(${tName}("${esc(value)}")`;
    }
  );
}

function injectClient(src) {
  let out = src;
  if (!out.includes('from "@/i18n/useAdminT"') && !out.includes("from '@/i18n/useAdminT'")) {
    out = out.replace(
      /^(\s*["']use client["']\s*;?\s*)/,
      `$1\nimport { useAdminT } from "@/i18n/useAdminT";\n`
    );
  }
  if (!out.includes("useAdminT()")) {
    // Prefer largest exported component: export default function Name
    const patterns = [
      /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{/,
      /export\s+function\s+\w+\s*\([^)]*\)\s*\{/,
      /export\s+default\s+function\s*\w*\s*\([^)]*\)\s*\{/,
    ];
    let done = false;
    for (const re of patterns) {
      const m = out.match(re);
      if (m) {
        const idx = m.index + m[0].length;
        out = out.slice(0, idx) + `\n  const { t } = useAdminT();\n` + out.slice(idx);
        done = true;
        break;
      }
    }
    if (!done) {
      // const Name = (...) => {
      const arrow = out.match(
        /export\s+default\s+function|\bfunction\s+[A-Z]\w*\s*\([^)]*\)\s*\{|const\s+[A-Z]\w*\s*=\s*\([^)]*\)\s*=>\s*\{/
      );
      if (arrow) {
        const idx = arrow.index + arrow[0].length;
        out = out.slice(0, idx) + `\n  const { t } = useAdminT();\n` + out.slice(idx);
      }
    }
  }
  return out;
}

function injectServer(src) {
  let out = src;
  if (!out.includes('from "@/i18n/adminUiI18n"')) {
    out = `import { adminT } from "@/i18n/adminUiI18n";\n` + out;
  }
  if (!out.includes("@/i18n/getAdminWebLocale")) {
    out = `import { getAdminWebLocale } from "@/i18n/getAdminWebLocale";\n` + out;
  }
  if (!out.includes("getAdminWebLocale()")) {
    const asyncFn = out.match(/export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{/);
    if (asyncFn) {
      const idx = asyncFn.index + asyncFn[0].length;
      out =
        out.slice(0, idx) +
        `\n  const locale = await getAdminWebLocale();\n  const t = (s: string) => adminT(s, locale);\n` +
        out.slice(idx);
    }
  }
  return out;
}

const files = [];
for (const t of targets) walk(t, files);

let changed = 0;
let skipped = 0;
const touched = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let src = before;
  const client = isClient(src);

  let wrapped = wrapProps(src, "t");
  wrapped = wrapJsxText(wrapped, "t");
  wrapped = wrapAlertConfirm(wrapped, "t");

  if (wrapped === src) {
    skipped += 1;
    continue;
  }

  // Wrapping happened — inject imports/hooks
  if (client) {
    src = injectClient(wrapped);
  } else {
    // If no async server locale, leave t unbound → force client conversion only when needed
    if (/export\s+default\s+async\s+function/.test(wrapped)) {
      src = injectServer(wrapped);
    } else {
      // Convert file to client so useAdminT works (safe for admin UI pages with literals)
      if (!isClient(wrapped)) {
        src = `"use client";\n\n` + injectClient(wrapped);
      } else {
        src = injectClient(wrapped);
      }
    }
  }

  if (src !== before) {
    fs.writeFileSync(file, src);
    changed += 1;
    touched.push(path.relative(root, file).replace(/\\/g, "/"));
  } else {
    skipped += 1;
  }
}

fs.writeFileSync(
  path.join(root, "src", "i18n", "admin-ui-wire-report.json"),
  JSON.stringify({ changed, skipped, touched }, null, 2)
);
console.log(JSON.stringify({ files: files.length, changed, skipped }, null, 2));
