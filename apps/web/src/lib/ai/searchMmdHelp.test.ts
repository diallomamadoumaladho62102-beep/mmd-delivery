import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_HELP_SLUGS } from "./searchMmdHelp";

const publicSlugs: readonly string[] = PUBLIC_HELP_SLUGS;
assert.ok(publicSlugs.includes("faq"));
assert.ok(publicSlugs.includes("how-it-works"));
assert.ok(publicSlugs.includes("drivers"));
assert.ok(publicSlugs.includes("restaurants"));
assert.ok(publicSlugs.includes("marketplace"));
assert.ok(publicSlugs.includes("privacy"));
assert.ok(publicSlugs.includes("terms"));
assert.ok(!publicSlugs.includes("admin"));

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "searchMmdHelp.ts"), "utf8");
const toolSrc = fs.readFileSync(path.join(here, "tools/client/helpTools.ts"), "utf8");
assert.match(src, /invented: false/);
assert.match(toolSrc, /I did not find an official public MMD answer/);
assert.doesNotMatch(src, /runbook/);

console.log("searchMmdHelp.test.ts OK");
