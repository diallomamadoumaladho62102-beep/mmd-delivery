import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const localesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "i18n",
  "locales",
);

const FILLS = {
  es: {
    "client.orderDetails.total": "Total",
    "client.security.errorTitle": "Error",
    "driver.tax.overview.withholding.no": "No",
    "restaurant.language.searchPlaceholder": "Search (English, Français, Español...)",
    "restaurant.security.errorTitle": "Error",
  },
  ar: {
    "restaurant.language.searchPlaceholder": "Search (English, Français, Español...)",
  },
  zh: {
    "restaurant.language.searchPlaceholder": "Search (English, Français, Español...)",
  },
  ff: {
    "client.orderDetails.total": "Kalaa",
    "driver.help.emailErrorTitle": "Iimeel",
    "restaurant.language.searchPlaceholder": "Search (English, Français, Español...)",
  },
};

function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== "object" || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

for (const [lang, rows] of Object.entries(FILLS)) {
  const p = path.join(localesDir, lang, "extras.json");
  const extras = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [key, value] of Object.entries(rows)) setPath(extras, key, value);
  fs.writeFileSync(p, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  console.log(lang, Object.keys(rows).length);
}
