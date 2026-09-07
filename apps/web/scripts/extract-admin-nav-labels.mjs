import fs from "node:fs";

const src = fs.readFileSync("src/lib/adminNav.ts", "utf8");
const labels = [...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
const uniq = [...new Set(labels)];
fs.writeFileSync("src/i18n/_admin-nav-labels.json", JSON.stringify(uniq, null, 2));
console.log("count", uniq.length);
