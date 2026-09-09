import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(scriptsDir, "..", "src", "i18n");
const catalogPath = path.join(i18nDir, "adminUiCatalog.json");
const translationsPath = path.join(scriptsDir, "portal-remaining-translations.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const translations = JSON.parse(fs.readFileSync(translationsPath, "utf8"));

let added = 0;
let updated = 0;
for (const [key, value] of Object.entries(translations)) {
  if (Object.hasOwn(catalog, key)) updated += 1;
  else added += 1;
  catalog[key] = { ...(catalog[key] || {}), ...value };
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
const ts = `/* AUTO-GENERATED — do not edit by hand */
import type { WebLocale } from "@/i18n/locales";

export type AdminUiTranslation = Partial<Record<WebLocale, string>> &
  Record<Exclude<WebLocale, "en">, string>;

export const ADMIN_UI_CATALOG: Record<string, AdminUiTranslation> = ${JSON.stringify(catalog, null, 2)} as const;
`;
fs.writeFileSync(path.join(i18nDir, "adminUiCatalog.generated.ts"), ts);
console.log(JSON.stringify({ added, updated, total: Object.keys(catalog).length }, null, 2));
