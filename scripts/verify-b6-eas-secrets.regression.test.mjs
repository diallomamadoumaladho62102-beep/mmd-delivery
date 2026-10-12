import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "verify-b6-eas-secrets.mjs"),
  "utf8",
);

assert.match(source, /supabase_publishable_prefix/);
assert.doesNotMatch(source, /supabase_anon_matches_prod/);
assert.match(source, /associatedDomains: \["applinks:www\.mmddelivery\.com"\]/);
assert.doesNotMatch(source, /applinks:mmddelivery\.com/);

console.log("verify-b6-eas-secrets.regression.test.mjs OK");
