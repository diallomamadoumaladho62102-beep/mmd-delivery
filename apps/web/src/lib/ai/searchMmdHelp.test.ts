import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_HELP_SLUGS } from "./searchMmdHelp";

assert.ok(PUBLIC_HELP_SLUGS.includes("faq"));
assert.ok(PUBLIC_HELP_SLUGS.includes("how-it-works"));
assert.ok(PUBLIC_HELP_SLUGS.includes("drivers"));
assert.ok(PUBLIC_HELP_SLUGS.includes("restaurants"));
assert.ok(PUBLIC_HELP_SLUGS.includes("marketplace"));
assert.ok(PUBLIC_HELP_SLUGS.includes("privacy"));
assert.ok(PUBLIC_HELP_SLUGS.includes("terms"));
assert.ok(!PUBLIC_HELP_SLUGS.includes("admin"));

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "searchMmdHelp.ts"), "utf8");
const toolSrc = fs.readFileSync(path.join(here, "tools/client/helpTools.ts"), "utf8");
assert.match(src, /invented: false/);
assert.match(toolSrc, /I did not find an official public MMD answer/);
assert.doesNotMatch(src, /runbook/);

console.log("searchMmdHelp.test.ts OK");
