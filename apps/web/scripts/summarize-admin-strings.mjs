import fs from "node:fs";
import path from "node:path";

const j = JSON.parse(
  fs.readFileSync("src/i18n/admin-ui-strings.extracted.json", "utf8")
);
console.log("total", j.total);
console.log("top25:");
for (const s of j.strings.slice(0, 25)) {
  console.log(s.count, JSON.stringify(s.text));
}

const pages = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name === "page.tsx") pages.push(f);
  }
}
walk("app/admin");
let client = 0;
let server = 0;
for (const p of pages) {
  const t = fs.readFileSync(p, "utf8");
  if (t.includes("use client")) client += 1;
  else server += 1;
}
console.log("pages", pages.length, "client", client, "server", server);
