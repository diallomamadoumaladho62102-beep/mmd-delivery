import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();

/** Target CSS widths from the device audit (iOS / Android / iPad / desktop). */
const VIEWPORTS = [390, 393, 412, 768, 820, 1024, 1280, 1440];

const css = readFileSync(join(webRoot, "app/globals.css"), "utf8");
const layout = readFileSync(join(webRoot, "app/layout.tsx"), "utf8");
const commissions = readFileSync(
  join(webRoot, "src/components/AdminCommissionsTable.tsx"),
  "utf8",
);
const shell = readFileSync(join(webRoot, "src/components/AdminShell.tsx"), "utf8");

assert.ok(VIEWPORTS.includes(390) && VIEWPORTS.includes(1440));
assert.match(css, /html,\s*\nbody\s*\{/);
assert.match(css, /overflow-x:\s*clip/);
assert.match(css, /env\(safe-area-inset-left/);
assert.match(layout, /viewportFit:\s*"cover"/);
assert.match(layout, /initialScale:\s*1/);
assert.match(commissions, /overflow-x-auto/);
assert.match(shell, /overflow-x-auto/);

console.log(
  `viewportResponsive tests passed (${VIEWPORTS.join(" / ")}px; page clip; table overflow-x-auto kept)`,
);
