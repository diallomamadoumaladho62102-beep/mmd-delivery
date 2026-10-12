import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appConfig = readFileSync(join(root, "app.config.ts"), "utf8");
const appJson = readFileSync(join(root, "apps/mobile/app.json"), "utf8");
const easJson = readFileSync(join(root, "eas.json"), "utf8");
const presence = readFileSync(join(root, "scripts/eas-env-presence.mjs"), "utf8");

for (const source of [appConfig, appJson]) {
  assert.match(source, /com\.maladho2025\.mmddelivery/);
  assert.match(source, /applinks:www\.mmddelivery\.com/);
  assert.doesNotMatch(source, /applinks:mmddelivery\.com"/);
}

assert.match(appConfig, /EXPO_PUBLIC_STRIPE_PK/);
assert.match(appConfig, /EXPO_PUBLIC_SUPABASE_URL/);
assert.match(appConfig, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
assert.match(appConfig, /EXPO_PUBLIC_MAPBOX_TOKEN/);
assert.doesNotMatch(appConfig, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
assert.match(easJson, /"environment": "production"/);
assert.doesNotMatch(easJson, /pk_live_|sb_publishable_|RNMAPBOX_MAPS_DOWNLOAD_TOKEN/);
assert.match(presence, /include-sensitive/);
assert.doesNotMatch(presence, /writeFileSync/);
assert.doesNotMatch(presence, /console\.log\(listed/);
assert.doesNotMatch(presence, /console\.log\(text/);
assert.doesNotMatch(presence, /console\.log\(secretText/);
assert.match(presence, /RNMAPBOX_MAPS_DOWNLOAD_TOKEN/);

console.log("mobile-config-identity.regression.test.mjs OK");
