import fs from "node:fs";
const p = "apps/web/src/i18n/adminUiCatalog.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.FAQ = {
  fr: "FAQ",
  es: "Preguntas frecuentes",
  ar: "الأسئلة الشائعة",
  zh: "常见问题",
  ff: "Naamne ɓurɗe naamneede",
};
fs.writeFileSync(p, JSON.stringify(c, null, 2));
const ts = `/* AUTO-GENERATED — do not edit by hand */
import type { WebLocale } from "@/i18n/locales";

export type AdminUiTranslation = Partial<Record<WebLocale, string>> &
  Record<Exclude<WebLocale, "en">, string>;

export const ADMIN_UI_CATALOG: Record<string, AdminUiTranslation> = ${JSON.stringify(c, null, 2)} as const;
`;
fs.writeFileSync("apps/web/src/i18n/adminUiCatalog.generated.ts", ts);
console.log("FAQ", c.FAQ);
