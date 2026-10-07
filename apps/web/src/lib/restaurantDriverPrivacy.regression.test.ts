import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const commandCenter = fs.readFileSync(
  path.join(root, "apps/web/src/lib/restaurantCommandCenter.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261007190000_restaurant_no_driver_location_read.sql"),
  "utf8",
);

assert.match(commandCenter, /distanceMeters: null/);
assert.match(commandCenter, /pickupLat: null/);
assert.match(commandCenter, /dropoffLat: null/);
assert.doesNotMatch(
  commandCenter,
  /lat: asNumber\(driverLocationMap/,
  "restaurant payload must not include driver coordinates",
);
assert.match(migration, /o\.client_id = auth\.uid\(\)/);
assert.match(migration, /o\.restaurant_id is distinct from auth\.uid\(\)/);
assert.doesNotMatch(
  migration,
  /order_participant_ids/,
  "restaurant order participants must not inherit driver GPS",
);
assert.match(migration, /set search_path = public/);
assert.match(migration, /p_driver_id = auth\.uid\(\)/);
assert.match(migration, /is_staff_user/);

console.log("restaurantDriverPrivacy.regression.test.ts OK");
