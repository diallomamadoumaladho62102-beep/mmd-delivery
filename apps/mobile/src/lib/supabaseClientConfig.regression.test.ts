/**
 * The mobile client must not send a fake publishable key when env is missing.
 * Import must stay non-throwing; requests fail with an explicit configuration error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../../lib/supabase.ts"), "utf8");

assert.match(src, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
assert.doesNotMatch(src, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
assert.doesNotMatch(src, /missing-supabase-publishable-key/);
assert.match(src, /isPrivilegedSupabaseClientKey/);
assert.match(src, /export const supabaseConfigured/);
assert.match(src, /SUPABASE_MISSING_CONFIG_MESSAGE/);
assert.match(src, /rejectUnconfiguredSupabaseRequest/);
assert.match(
  src,
  /supabaseConfigured\s*\?\s*\{\}\s*:\s*\{\s*global:\s*\{\s*fetch:\s*rejectUnconfiguredSupabaseRequest\s*\}/,
);
assert.match(src, /Never throw at module import/);

console.log("supabaseClientConfig.regression.test.ts OK");
