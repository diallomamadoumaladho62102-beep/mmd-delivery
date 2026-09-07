import fs from "node:fs";

const p = new URL("../src/i18n/adminNavI18n.ts", import.meta.url);
let s = fs.readFileSync(p, "utf8");
const ar = "الضرائب".length; // placeholder to avoid encoding issues in tooling
const taxes = "\u0627\u0644\u0636\u0631\u0627\u0626\u0628";
s = s.replace(
  /"Taxi Taxes": \{ fr: "Taxes taxi", es: "Impuestos taxi", ar: "[^"]+", zh:/,
  `"Taxi Taxes": { fr: "Taxes taxi", es: "Impuestos taxi", ar: "${taxes}", zh:`,
);
fs.writeFileSync(p, s);
console.log("ok", taxes, ar);
